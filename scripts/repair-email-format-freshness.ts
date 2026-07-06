/**
 * Scoped repair for companies "poisoned" by a failed/empty email-format
 * discovery — the pre-fix bug where an AI/source/search run with no usable
 * evidence still stamped `emailFormatDiscoveredAt = now` (and authority) on a
 * company that has no email domain/pattern. That made the UI show a bogus
 * "Last checked <date>" on an Unavailable format.
 *
 *   npx tsx scripts/repair-email-format-freshness.ts --scan
 *   npx tsx scripts/repair-email-format-freshness.ts --scan --apply
 *   npx tsx scripts/repair-email-format-freshness.ts --companies <id1,id2> --apply
 *
 * Dry-run by default; pass --apply to write. `--scan` finds a BOUNDED batch
 * (newest 100) of clearly-affected companies:
 *
 *   - has at least one allocated/materialized person;
 *   - has NO usable email domain + supported pattern;
 *   - has a stored `emailFormatDiscoveredAt` freshness marker (the false
 *     "completed" state).
 *
 * Repair clears ONLY the false-positive freshness/authority markers so a later
 * AI/source/manual discovery runs cleanly. It NEVER invents a domain or
 * pattern, never reruns Apify, never consumes Discover quota, never touches
 * people rows, and is idempotent. Prints only ids and counts.
 */
import { prisma } from "@/lib/db";
import { hasUsableCompanyEmailFormat } from "@/services/prospects/company-email-format";

const SCAN_LIMIT = 100;

function parseArgs(argv: string[]): { companyIds: string[]; scan: boolean; apply: boolean } {
  const index = argv.indexOf("--companies");
  const raw = index >= 0 ? argv[index + 1] ?? "" : "";
  return {
    companyIds: raw.split(",").map((value) => value.trim()).filter(Boolean),
    scan: argv.includes("--scan"),
    apply: argv.includes("--apply")
  };
}

type Candidate = {
  id: string;
  hasUsableFormat: boolean;
  hasFreshnessMarker: boolean;
  peopleCount: number;
};

async function evaluate(companyId: string): Promise<Candidate | null> {
  const company = await prisma.prospectCompany.findUnique({ where: { id: companyId } });
  if (!company) {
    return null;
  }
  const peopleCount = await prisma.prospectPerson.count({ where: { companyId } });
  return {
    id: company.id,
    hasUsableFormat: hasUsableCompanyEmailFormat(company),
    hasFreshnessMarker: Boolean(company.emailFormatDiscoveredAt),
    peopleCount
  };
}

function eligibility(candidate: Candidate, explicit: boolean): string | null {
  if (candidate.hasUsableFormat) {
    return "has a usable email format (never cleared)";
  }
  if (!candidate.hasFreshnessMarker) {
    return "no freshness marker to clear";
  }
  if (!explicit && candidate.peopleCount === 0) {
    return "no allocated people";
  }
  return null;
}

async function scanCandidates(): Promise<Candidate[]> {
  // Bounded: newest companies that carry a freshness marker but no usable format.
  const companies = await prisma.prospectCompany.findMany({
    where: { emailFormatDiscoveredAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT
  });
  const candidates: Candidate[] = [];
  for (const company of companies) {
    if (hasUsableCompanyEmailFormat(company)) {
      continue;
    }
    const peopleCount = await prisma.prospectPerson.count({ where: { companyId: company.id } });
    if (peopleCount === 0) {
      continue;
    }
    candidates.push({
      id: company.id,
      hasUsableFormat: false,
      hasFreshnessMarker: true,
      peopleCount
    });
  }
  return candidates;
}

async function applyRepair(companyId: string): Promise<void> {
  // Clear ONLY the false-positive completion markers. Domain/pattern are already
  // null (that is the eligibility precondition); people are untouched.
  await prisma.prospectCompany.update({
    where: { id: companyId },
    data: {
      emailFormatDiscoveredAt: null,
      emailFormatAuthority: "UNRESOLVED",
      emailFormatReason: null
    }
  });
}

async function main(): Promise<void> {
  const { companyIds, scan, apply } = parseArgs(process.argv.slice(2));
  if (companyIds.length === 0 && !scan) {
    console.error(
      "Usage: npx tsx scripts/repair-email-format-freshness.ts (--scan | --companies <id1,id2>) [--apply]"
    );
    process.exitCode = 1;
    return;
  }

  const explicit = companyIds.length > 0;
  const candidates: Candidate[] = [];
  if (explicit) {
    for (const companyId of companyIds) {
      const candidate = await evaluate(companyId);
      if (!candidate) {
        console.info(`[repair-email-format] SKIP ${companyId}: not found`);
        continue;
      }
      candidates.push(candidate);
    }
  } else {
    candidates.push(...(await scanCandidates()));
  }

  console.info(
    `[repair-email-format] ${apply ? "APPLY" : "DRY RUN"} — ${candidates.length} candidate company(ies)${explicit ? "" : ` (bounded scan, max ${SCAN_LIMIT})`}.`
  );

  for (const candidate of candidates) {
    const skip = eligibility(candidate, explicit);
    if (skip) {
      console.info(`[repair-email-format] SKIP ${candidate.id}: ${skip}`);
      continue;
    }
    console.info(
      `[repair-email-format] ${candidate.id}: people=${candidate.peopleCount}, clearing false freshness marker — eligible.`
    );
    if (apply) {
      await applyRepair(candidate.id);
      console.info(`[repair-email-format] ${candidate.id}: cleared.`);
    }
  }

  if (!apply) {
    console.info("[repair-email-format] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error("[repair-email-format] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
