import type { PrismaClient, ProspectCompany, ProspectCompanyPosition, ProspectPerson } from "@prisma/client";
import DataLoader from "dataloader";

// Per-request DataLoaders. Every loader is scoped to the authenticated user's
// id so batching can never leak another user's rows, and they collapse the
// Company -> Positions -> People graph into a handful of queries instead of the
// N+1 fan-out a nested query would otherwise produce.
export type ProspectLoaders = {
  companyById: DataLoader<string, ProspectCompany | null>;
  positionsByCompanyId: DataLoader<string, ProspectCompanyPosition[]>;
  positionById: DataLoader<string, ProspectCompanyPosition | null>;
  peopleByPositionId: DataLoader<string, ProspectPerson[]>;
  peopleCountByCompanyId: DataLoader<string, number>;
  peopleCountByPositionId: DataLoader<string, number>;
  emailStatusRowsByCompanyId: DataLoader<string, EmailStatusRow[]>;
  /** User-scoped suppression reason per normalized email (null = not suppressed). */
  suppressionReasonByEmail: DataLoader<string, string | null>;
};

export type EmailStatusRow = Pick<
  ProspectPerson,
  | "firstName"
  | "lastName"
  | "inferredEmail"
  | "emailStatus"
  | "emailConfidence"
  | "emailPattern"
  | "emailSource"
>;

function groupBy<T, K extends string>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

export function createLoaders(prisma: PrismaClient, userId: string): ProspectLoaders {
  const companyById = new DataLoader<string, ProspectCompany | null>(async (ids) => {
    const rows = await prisma.prospectCompany.findMany({
      where: { id: { in: [...ids] }, userId }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const positionsByCompanyId = new DataLoader<string, ProspectCompanyPosition[]>(async (companyIds) => {
    const rows = await prisma.prospectCompanyPosition.findMany({
      where: { companyId: { in: [...companyIds] }, company: { userId } },
      orderBy: { displayName: "asc" }
    });
    const grouped = groupBy(rows, (row) => row.companyId);
    return companyIds.map((id) => grouped.get(id) ?? []);
  });

  const positionById = new DataLoader<string, ProspectCompanyPosition | null>(async (ids) => {
    const rows = await prisma.prospectCompanyPosition.findMany({
      where: { id: { in: [...ids] }, company: { userId } }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const peopleByPositionId = new DataLoader<string, ProspectPerson[]>(async (positionIds) => {
    const rows = await prisma.prospectPerson.findMany({
      where: { positionId: { in: [...positionIds] }, userId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
    });
    const grouped = groupBy(rows, (row) => row.positionId);
    return positionIds.map((id) => grouped.get(id) ?? []);
  });

  const peopleCountByCompanyId = new DataLoader<string, number>(async (companyIds) => {
    const rows = await prisma.prospectPerson.groupBy({
      by: ["companyId"],
      where: { companyId: { in: [...companyIds] }, userId },
      _count: { _all: true }
    });
    const byId = new Map(rows.map((row) => [row.companyId, row._count._all]));
    return companyIds.map((id) => byId.get(id) ?? 0);
  });

  const peopleCountByPositionId = new DataLoader<string, number>(async (positionIds) => {
    const rows = await prisma.prospectPerson.groupBy({
      by: ["positionId"],
      where: { positionId: { in: [...positionIds] }, userId },
      _count: { _all: true }
    });
    const byId = new Map(rows.map((row) => [row.positionId, row._count._all]));
    return positionIds.map((id) => byId.get(id) ?? 0);
  });

  // Per-person email + status rows (companies are bounded to tens of people).
  // The Company.emailStatusCounts resolver overlays live suppression state on
  // these before aggregating, so failed/unsubscribed addresses are never
  // counted as usable.
  const emailStatusRowsByCompanyId = new DataLoader<string, EmailStatusRow[]>(async (companyIds) => {
    const rows = await prisma.prospectPerson.findMany({
      where: { companyId: { in: [...companyIds] }, userId },
      select: {
        companyId: true,
        firstName: true,
        lastName: true,
        inferredEmail: true,
        emailStatus: true,
        emailConfidence: true,
        emailPattern: true,
        emailSource: true
      }
    });
    const grouped = groupBy(rows, (row) => row.companyId);
    return companyIds.map(
      (id) =>
        grouped.get(id)?.map((row) => ({
          firstName: row.firstName,
          lastName: row.lastName,
          inferredEmail: row.inferredEmail,
          emailStatus: row.emailStatus,
          emailConfidence: row.emailConfidence,
          emailPattern: row.emailPattern,
          emailSource: row.emailSource
        })) ?? []
    );
  });

  const suppressionReasonByEmail = new DataLoader<string, string | null>(async (emails) => {
    const rows = await prisma.suppression.findMany({
      where: { userId, email: { in: [...emails] } },
      select: { email: true, reason: true }
    });
    const byEmail = new Map(rows.map((row) => [row.email, row.reason as string]));
    return emails.map((email) => byEmail.get(email) ?? null);
  });

  return {
    companyById,
    positionsByCompanyId,
    positionById,
    peopleByPositionId,
    peopleCountByCompanyId,
    peopleCountByPositionId,
    emailStatusRowsByCompanyId,
    suppressionReasonByEmail
  };
}
