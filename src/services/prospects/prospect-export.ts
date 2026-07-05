import { randomBytes } from "node:crypto";

import type { PrismaClient, ProspectCompany, ProspectCompanyPosition, ProspectPerson } from "@prisma/client";
import { utils, write, type WorkBook, type WorkSheet } from "xlsx";

import { badInputError, forbiddenError, notFoundError } from "@/graphql/errors";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { createImport } from "@/services/imports";
import { displayNameForCategory, isPositionCategory, type PositionCategory } from "@/lib/prospect-enums";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";

export const PROSPECT_EXPORT_MAX_ROWS = Number.parseInt(process.env.PROSPECT_EXPORT_MAX_ROWS ?? "5000", 10);
export const PROSPECT_EXPORT_TTL_SECONDS = 15 * 60;

const EXPORTABLE_STATUSES = new Set(["VERIFIED", "INFERRED_HIGH", "INFERRED_MEDIUM", "INFERRED_LOW"]);
const UNAVAILABLE_STATUSES = new Set(["UNAVAILABLE", "INVALID"]);
const EXPORT_REDIS_PREFIX = "prospect-export";
const EXPORT_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ProspectSelectionMode = "EXPLICIT" | "ALL_MATCHING";

export type ProspectSelectionInput = {
  companyId: string;
  mode: ProspectSelectionMode;
  selectedIds?: string[] | null;
  excludedIds?: string[] | null;
  positionCategory?: PositionCategory | null;
};

export type ProspectSelectionReview = {
  selectedCount: number;
  exportableCount: number;
  unavailableEmailCount: number;
  suppressedCount: number;
  duplicateEmailCount: number;
};

export type ProspectExportRecord = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  jobTitle: string;
  positionCategory: string;
  company: string;
  location: string;
  linkedinUrl: string;
  emailStatus: string;
  emailConfidence: string;
  emailPattern: string;
  emailSource: string;
};

type ResolvedSelection = {
  company: ProspectCompany;
  rows: ProspectExportRecord[];
  review: ProspectSelectionReview;
  fileName: string;
};

type PersonWithPosition = ProspectPerson & {
  position: ProspectCompanyPosition;
};

type StoredProspectExport = {
  userId: string;
  fileName: string;
  rows: ProspectExportRecord[];
  createdAt: string;
};

function uniqueStrings(values: readonly string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function sanitizeFileComponent(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "prospects"
  );
}

function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function prospectSelectionCategoryLabel(category: PositionCategory | null | undefined): string {
  return category ? displayNameForCategory(category) : "All Prospects";
}

export function buildProspectExportFileName(companyName: string, category: PositionCategory | null | undefined, date = new Date()) {
  return `sendloom-${sanitizeFileComponent(companyName)}-${sanitizeFileComponent(prospectSelectionCategoryLabel(category))}-${isoDate(date)}.xlsx`;
}

export function sanitizeExportString(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function toExportRecord(person: PersonWithPosition, company: ProspectCompany): ProspectExportRecord {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName,
    email: person.inferredEmail ?? "",
    jobTitle: person.currentTitle ?? "",
    positionCategory: isPositionCategory(person.position.category)
      ? displayNameForCategory(person.position.category)
      : "Other",
    company: company.name,
    location: person.location ?? [person.city, person.state, person.country].filter(Boolean).join(", "),
    linkedinUrl: person.linkedinUrl,
    emailStatus: person.emailStatus,
    emailConfidence: person.emailConfidence,
    emailPattern: person.emailPattern ?? "",
    emailSource: person.emailSource ?? ""
  };
}

async function loadOwnedCompany(prisma: PrismaClient, userId: string, companyId: string) {
  const company = await prisma.prospectCompany.findFirst({ where: { id: companyId, userId } });
  if (!company) {
    throw notFoundError("Company not found.");
  }
  return company;
}

async function attachPositions(
  prisma: PrismaClient,
  userId: string,
  people: ProspectPerson[]
): Promise<PersonWithPosition[]> {
  const positionIds = uniqueStrings(people.map((person) => person.positionId));
  if (positionIds.length === 0) {
    return [];
  }

  const positions = await prisma.prospectCompanyPosition.findMany({
    where: {
      id: { in: positionIds },
      company: { userId }
    }
  });
  const byId = new Map(positions.map((position) => [position.id, position]));
  return people.flatMap((person) => {
    const position = byId.get(person.positionId);
    return position ? [{ ...person, position }] : [];
  });
}

async function validateExcludedIds(
  prisma: PrismaClient,
  userId: string,
  companyId: string,
  excludedIds: string[]
) {
  if (excludedIds.length === 0) {
    return;
  }

  const rows = await prisma.prospectPerson.findMany({
    where: {
      userId,
      companyId,
      id: { in: excludedIds }
    }
  });

  if (rows.length !== excludedIds.length) {
    throw badInputError("One or more excluded prospects do not belong to this company.");
  }
}

async function resolveSelectedPeople(
  prisma: PrismaClient,
  userId: string,
  input: ProspectSelectionInput
): Promise<ProspectPerson[]> {
  const excludedIds = uniqueStrings(input.excludedIds);

  if (input.mode === "EXPLICIT") {
    const selectedIds = uniqueStrings(input.selectedIds);
    if (selectedIds.length === 0) {
      return [];
    }

    const rows = await prisma.prospectPerson.findMany({
      where: {
        userId,
        companyId: input.companyId,
        id: { in: selectedIds }
      }
    });

    if (rows.length !== selectedIds.length) {
      throw badInputError("One or more selected prospects do not belong to this company.");
    }

    return rows;
  }

  if (input.mode !== "ALL_MATCHING") {
    throw badInputError("Invalid prospect selection mode.");
  }

  await validateExcludedIds(prisma, userId, input.companyId, excludedIds);

  const rows = await prisma.prospectPerson.findMany({
    where: {
      userId,
      companyId: input.companyId,
      ...(input.positionCategory ? { position: { category: input.positionCategory } } : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });

  const excluded = new Set(excludedIds);
  return rows.filter((person) => !excluded.has(person.id));
}

async function loadSuppressedEmails(prisma: PrismaClient, userId: string, emails: string[]) {
  const uniqueEmails = uniqueStrings(emails);
  if (uniqueEmails.length === 0) {
    return new Set<string>();
  }

  const suppressions = await prisma.suppression.findMany({
    where: {
      userId,
      email: { in: uniqueEmails }
    }
  });

  return new Set(suppressions.map((row) => normalizeEmail(row.email)));
}

export async function resolveProspectSelection(
  prisma: PrismaClient,
  userId: string,
  input: ProspectSelectionInput
): Promise<ResolvedSelection> {
  if (!input.companyId) {
    throw badInputError("Company is required.");
  }
  if (input.positionCategory && !isPositionCategory(input.positionCategory)) {
    throw badInputError("Invalid position category.");
  }

  const company = await loadOwnedCompany(prisma, userId, input.companyId);
  const selectedPeople = await resolveSelectedPeople(prisma, userId, input);
  const storedSuppressedEmails = await loadSuppressedEmails(
    prisma,
    userId,
    selectedPeople.map((person) => normalizeEmail(person.inferredEmail)).filter(Boolean)
  );
  const derivedPeople = selectedPeople.map((person) => ({
    ...person,
    ...resolveProspectPersonEmail(person, company, {
      allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS,
      suppressed: Boolean(person.inferredEmail && storedSuppressedEmails.has(normalizeEmail(person.inferredEmail)))
    })
  }));
  const selectedWithPositions = await attachPositions(prisma, userId, derivedPeople);
  const normalizedEmails = selectedWithPositions.map((person) => normalizeEmail(person.inferredEmail)).filter(Boolean);
  const suppressedEmails = await loadSuppressedEmails(prisma, userId, normalizedEmails);

  const seenEmails = new Set<string>();
  const review: ProspectSelectionReview = {
    selectedCount: selectedWithPositions.length,
    exportableCount: 0,
    unavailableEmailCount: 0,
    suppressedCount: 0,
    duplicateEmailCount: 0
  };
  const rows: ProspectExportRecord[] = [];

  for (const person of selectedWithPositions) {
    const email = normalizeEmail(person.inferredEmail);
    const status = person.emailStatus;

    if (status === "SUPPRESSED" || (email && suppressedEmails.has(email))) {
      review.suppressedCount += 1;
      continue;
    }

    if (!email || UNAVAILABLE_STATUSES.has(status) || !EXPORTABLE_STATUSES.has(status)) {
      review.unavailableEmailCount += 1;
      continue;
    }

    if (seenEmails.has(email)) {
      review.duplicateEmailCount += 1;
      continue;
    }

    seenEmails.add(email);
    rows.push(toExportRecord({ ...person, inferredEmail: email }, company));
  }

  review.exportableCount = rows.length;
  if (rows.length > PROSPECT_EXPORT_MAX_ROWS) {
    throw forbiddenError(`Prospect exports are limited to ${PROSPECT_EXPORT_MAX_ROWS.toLocaleString()} records.`);
  }

  return {
    company,
    rows,
    review,
    fileName: buildProspectExportFileName(company.name, input.positionCategory ?? null)
  };
}

export const PROSPECT_EXPORT_HEADERS = [
  "First Name",
  "Last Name",
  "Full Name",
  "Email",
  "Job Title",
  "Position Category",
  "Company",
  "Location",
  "LinkedIn URL",
  "Email Status",
  "Email Confidence",
  "Email Pattern",
  "Email Source"
] as const;

function exportRowsToMatrix(rows: ProspectExportRecord[]) {
  return [
    [...PROSPECT_EXPORT_HEADERS],
    ...rows.map((row) => [
      row.firstName,
      row.lastName,
      row.fullName,
      row.email,
      row.jobTitle,
      row.positionCategory,
      row.company,
      row.location,
      row.linkedinUrl,
      row.emailStatus,
      row.emailConfidence,
      row.emailPattern,
      row.emailSource
    ].map(sanitizeExportString))
  ];
}

function styleWorksheet(worksheet: WorkSheet, rowCount: number) {
  worksheet["!cols"] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
    { wch: 30 },
    { wch: 32 },
    { wch: 22 },
    { wch: 24 },
    { wch: 30 },
    { wch: 42 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 }
  ];
  worksheet["!rows"] = [{ hpt: 24 }];
  worksheet["!autofilter"] = { ref: `A1:M${Math.max(1, rowCount)}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

  for (let index = 0; index < PROSPECT_EXPORT_HEADERS.length; index += 1) {
    const cell = worksheet[utils.encode_cell({ r: 0, c: index })];
    if (cell && typeof cell === "object") {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "163A2D" } },
        alignment: { vertical: "center", wrapText: true }
      };
    }
  }
}

export function buildProspectExportWorkbook(rows: ProspectExportRecord[]): Buffer {
  const worksheet = utils.aoa_to_sheet(exportRowsToMatrix(rows));
  styleWorksheet(worksheet, rows.length + 1);
  const workbook: WorkBook = {
    SheetNames: ["Prospects"],
    Sheets: { Prospects: worksheet },
    Props: {
      Title: "Sendloom Prospect Export",
      Subject: "Prospect export",
      Author: "Sendloom",
      CreatedDate: new Date()
    }
  };

  return write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

function exportRedisKey(id: string) {
  return `${EXPORT_REDIS_PREFIX}:${id}`;
}

export async function prepareProspectExport(prisma: PrismaClient, userId: string, input: ProspectSelectionInput) {
  const resolved = await resolveProspectSelection(prisma, userId, input);
  const exportId = randomBytes(24).toString("base64url");
  const payload: StoredProspectExport = {
    userId,
    fileName: resolved.fileName,
    rows: resolved.rows,
    createdAt: new Date().toISOString()
  };

  await getRedis().set(exportRedisKey(exportId), JSON.stringify(payload), "EX", PROSPECT_EXPORT_TTL_SECONDS);

  return {
    id: exportId,
    fileName: resolved.fileName,
    // Safe company name for activity logging only — not part of the GraphQL
    // ProspectExport type, so it is never serialized to the client.
    companyName: resolved.company.name,
    downloadUrl: `/api/prospects/exports/${exportId}`,
    review: resolved.review
  };
}

export async function readProspectExport(exportId: string, userId: string) {
  const raw = await getRedis().get(exportRedisKey(exportId));
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as StoredProspectExport;
  if (parsed.userId !== userId) {
    return null;
  }

  return parsed;
}

export async function deleteProspectExport(exportId: string) {
  await getRedis().del(exportRedisKey(exportId));
}

export async function createProspectImport(prisma: PrismaClient, userId: string, input: ProspectSelectionInput) {
  const resolved = await resolveProspectSelection(prisma, userId, input);
  const content = buildProspectExportWorkbook(resolved.rows);
  // Stage as pending field selection: the import lands in the Imports page
  // Template fields picker only and is not finalized until the operator saves
  // fields. It is never marked PROCESSED here, and no sequence is created.
  const importRecord = await createImport(resolved.fileName, EXPORT_MIME_TYPE, content, userId, {
    pendingFieldSelection: true
  });

  const baseUrl = env.APP_BASE_URL.replace(/\/+$/, "");
  return {
    importId: importRecord.id,
    fileName: importRecord.fileName,
    rowCount: importRecord.rowCount,
    viewUrl: `${baseUrl}/imports?pendingImportId=${encodeURIComponent(importRecord.id)}`,
    review: resolved.review
  };
}
