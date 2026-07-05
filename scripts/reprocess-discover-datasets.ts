/**
 * Scoped repair for Discover searches whose provider run SUCCEEDED and stored a
 * dataset, but whose ingestion lost the items (e.g. the strict company-slug
 * rejection where "jpmorgan-chase" !== "jpmorganchase" dropped every profile),
 * leaving a READY search with zero allocated people.
 *
 *   npx tsx scripts/reprocess-discover-datasets.ts --scan
 *   npx tsx scripts/reprocess-discover-datasets.ts --scan --apply
 *   npx tsx scripts/reprocess-discover-datasets.ts --searches <id1,id2,...> --apply
 *
 * Dry-run by default; pass --apply to write. `--scan` finds a BOUNDED batch
 * (newest first, max 50) of repair-eligible searches:
 *
 *   - status READY (a FAILED search has its own in-app Retry path);
 *   - a stored Apify dataset id and a recorded provider item count > 0;
 *   - ZERO ProspectSearchPerson allocations.
 *
 * Repair re-reads the ALREADY-STORED dataset by dataset id and re-runs the
 * corrected normalization/eligibility/materialization pipeline:
 *
 *   - it NEVER starts a new Apify actor run;
 *   - it NEVER consumes a user's daily Discover quota;
 *   - it NEVER runs AI email-format discovery (people inherit the company's
 *     current canonical format, so an existing manual override applies);
 *   - it is idempotent: allocations are (searchId, personId) upserts capped at
 *     the search's own maxResults, so re-running never duplicates or inflates.
 *
 * Prints only ids and counts — never names, emails, or LinkedIn URLs.
 */
import { prisma } from "@/lib/db";
import { createProspectServices } from "@/services/prospects/prospect-services";

const SCAN_LIMIT = 50;

function parseArgs(argv: string[]): { searchIds: string[]; scan: boolean; apply: boolean } {
  const index = argv.indexOf("--searches");
  const raw = index >= 0 ? argv[index + 1] ?? "" : "";
  return {
    searchIds: raw.split(",").map((value) => value.trim()).filter(Boolean),
    scan: argv.includes("--scan"),
    apply: argv.includes("--apply")
  };
}

type Candidate = {
  id: string;
  userId: string;
  status: string;
  apifyDatasetId: string | null;
  totalFound: number | null;
  allocationCount: number;
};

async function loadCandidate(searchId: string): Promise<Candidate | null> {
  const search = await prisma.prospectSearch.findUnique({ where: { id: searchId } });
  if (!search) {
    return null;
  }
  const allocationCount = await prisma.prospectSearchPerson.count({ where: { searchId } });
  return {
    id: search.id,
    userId: search.userId,
    status: search.status,
    apifyDatasetId: search.apifyDatasetId,
    totalFound: search.totalFound,
    allocationCount
  };
}

function eligibility(candidate: Candidate, explicit: boolean): string | null {
  if (!candidate.apifyDatasetId) {
    return "no stored dataset id";
  }
  if (explicit) {
    // Explicit ids are operator-vetted; only the hard requirement applies.
    return null;
  }
  if (candidate.status !== "READY") {
    return `status is ${candidate.status}, not READY`;
  }
  if (!candidate.totalFound || candidate.totalFound <= 0) {
    return `provider item count is ${candidate.totalFound ?? 0}`;
  }
  if (candidate.allocationCount > 0) {
    return `${candidate.allocationCount} allocation(s) already exist`;
  }
  return null;
}

async function scanCandidates(): Promise<Candidate[]> {
  const searches = await prisma.prospectSearch.findMany({
    where: { status: "READY", apifyDatasetId: { not: null }, totalFound: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT
  });
  const candidates: Candidate[] = [];
  for (const search of searches) {
    const allocationCount = await prisma.prospectSearchPerson.count({ where: { searchId: search.id } });
    if (allocationCount === 0) {
      candidates.push({
        id: search.id,
        userId: search.userId,
        status: search.status,
        apifyDatasetId: search.apifyDatasetId,
        totalFound: search.totalFound,
        allocationCount
      });
    }
  }
  return candidates;
}

async function main(): Promise<void> {
  const { searchIds, scan, apply } = parseArgs(process.argv.slice(2));
  if (searchIds.length === 0 && !scan) {
    console.error(
      "Usage: npx tsx scripts/reprocess-discover-datasets.ts (--scan | --searches <id1,id2,...>) [--apply]"
    );
    process.exitCode = 1;
    return;
  }

  const explicit = searchIds.length > 0;
  const candidates: Candidate[] = [];
  if (explicit) {
    for (const searchId of searchIds) {
      const candidate = await loadCandidate(searchId);
      if (!candidate) {
        console.info(`[reprocess-discover] SKIP ${searchId}: not found`);
        continue;
      }
      candidates.push(candidate);
    }
  } else {
    candidates.push(...(await scanCandidates()));
  }

  console.info(
    `[reprocess-discover] ${apply ? "APPLY" : "DRY RUN"} — ${candidates.length} candidate search(es)${explicit ? "" : ` (bounded scan, max ${SCAN_LIMIT})`}.`
  );

  const services = apply ? createProspectServices(prisma) : null;

  for (const candidate of candidates) {
    const skip = eligibility(candidate, explicit);
    if (skip) {
      console.info(`[reprocess-discover] SKIP ${candidate.id}: ${skip}`);
      continue;
    }
    console.info(
      `[reprocess-discover] ${candidate.id}: status=${candidate.status} providerItems=${candidate.totalFound ?? 0} allocations=${candidate.allocationCount} — eligible.`
    );
    if (!services) {
      continue;
    }
    try {
      const updated = await services.prospectSearch.reprocessSearchFromStoredDataset(candidate.userId, candidate.id);
      console.info(
        `[reprocess-discover] ${candidate.id}: repaired — status=${updated.status} peopleAllocated=${updated.totalProcessed}.`
      );
    } catch (error) {
      console.error(
        `[reprocess-discover] ${candidate.id}: FAILED — ${error instanceof Error ? error.message : "unknown error"}`
      );
      process.exitCode = 1;
    }
  }

  if (!apply) {
    console.info("[reprocess-discover] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error("[reprocess-discover] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
