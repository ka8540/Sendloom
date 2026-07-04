/**
 * Scoped repair for Discover searches that were over-granted from the shared
 * cache (the pre-allocation bug where a new user's search materialized the
 * ENTIRE cached pool instead of its 10-person batch).
 *
 *   npx tsx scripts/repair-discover-allocations.ts --searches <id1,id2,...>
 *   npx tsx scripts/repair-discover-allocations.ts --searches <id1> --apply
 *
 * Explicit search ids are REQUIRED — this never scans or guesses. Dry-run by
 * default; pass --apply to write. For each search it verifies the evidence of a
 * clearly broken full-pool grant before touching anything:
 *
 *   - the search is READY and its resultSource is CACHE (a full cache reuse);
 *   - it has NO "Add 10 more" expansions (legitimate accumulation via Add More
 *     is always preserved);
 *   - its allocation count exceeds its own maxResults cap.
 *
 * A search failing any check is skipped with the reason. Repair keeps the
 * FIRST maxResults grants deterministically (allocationOrder, i.e. the stable
 * provider/backfill order) and removes only the excess ProspectSearchPerson
 * rows. An excess person's materialized ProspectPerson row is removed only
 * when no OTHER search of the same user still holds a grant for it. The shared
 * DiscoverSearchCache/CachePerson pool and every other user's records are
 * never touched, and totalProcessed is recalculated so grouped counts stay
 * consistent. Prints only ids and counts — never names or emails.
 */
import { prisma } from "@/lib/db";

type Plan = {
  searchId: string;
  keep: number;
  removeAllocations: string[];
  removePeople: string[];
};

function parseArgs(argv: string[]): { searchIds: string[]; apply: boolean } {
  const index = argv.indexOf("--searches");
  const raw = index >= 0 ? argv[index + 1] ?? "" : "";
  return {
    searchIds: raw.split(",").map((value) => value.trim()).filter(Boolean),
    apply: argv.includes("--apply")
  };
}

async function planRepair(searchId: string): Promise<Plan | { searchId: string; skipped: string }> {
  const search = await prisma.prospectSearch.findUnique({ where: { id: searchId } });
  if (!search) {
    return { searchId, skipped: "not found" };
  }
  if (search.status !== "READY") {
    return { searchId, skipped: `status is ${search.status}, not READY` };
  }
  if (search.resultSource !== "CACHE") {
    return { searchId, skipped: `resultSource is ${search.resultSource ?? "unknown"}, not CACHE` };
  }
  const expansions = await prisma.discoverSearchExpansion.count({ where: { searchId } });
  if (expansions > 0) {
    return { searchId, skipped: `${expansions} Add-More expansion(s) exist — legitimate accumulation is preserved` };
  }
  const limit = search.maxResults > 0 ? search.maxResults : 10;
  const allocations = await prisma.prospectSearchPerson.findMany({
    where: { searchId },
    orderBy: [{ allocationOrder: "asc" }, { allocatedAt: "asc" }, { id: "asc" }]
  });
  if (allocations.length <= limit) {
    return { searchId, skipped: `allocation (${allocations.length}) is within the ${limit}-person cap` };
  }

  const excess = allocations.slice(limit);
  const excessPersonIds = excess.map((row) => row.personId);
  // A person stays materialized if any OTHER search of this user still grants it.
  const otherGrants = await prisma.prospectSearchPerson.findMany({
    where: { personId: { in: excessPersonIds }, searchId: { not: searchId }, userId: search.userId },
    select: { personId: true }
  });
  const keptElsewhere = new Set(otherGrants.map((row) => row.personId));

  return {
    searchId,
    keep: limit,
    removeAllocations: excess.map((row) => row.id),
    removePeople: excessPersonIds.filter((personId) => !keptElsewhere.has(personId))
  };
}

async function applyRepair(plan: Plan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.prospectSearchPerson.deleteMany({ where: { id: { in: plan.removeAllocations } } });
    if (plan.removePeople.length > 0) {
      // Scoped to the ids computed above — user-owned rows only, never the
      // shared cache tables.
      await tx.prospectPerson.deleteMany({ where: { id: { in: plan.removePeople } } });
    }
    await tx.prospectSearch.update({
      where: { id: plan.searchId },
      data: { totalProcessed: plan.keep }
    });
  });
}

async function main(): Promise<void> {
  const { searchIds, apply } = parseArgs(process.argv.slice(2));
  if (searchIds.length === 0) {
    console.error("Usage: npx tsx scripts/repair-discover-allocations.ts --searches <id1,id2,...> [--apply]");
    process.exitCode = 1;
    return;
  }

  console.info(`[repair-discover] ${apply ? "APPLY" : "DRY RUN"} for ${searchIds.length} search id(s).`);
  for (const searchId of searchIds) {
    const plan = await planRepair(searchId);
    if ("skipped" in plan) {
      console.info(`[repair-discover] SKIP ${searchId}: ${plan.skipped}`);
      continue;
    }
    console.info(
      `[repair-discover] ${searchId}: keep first ${plan.keep}, remove ${plan.removeAllocations.length} grant(s), ` +
        `${plan.removePeople.length} person row(s) not granted elsewhere.`
    );
    if (apply) {
      await applyRepair(plan);
      console.info(`[repair-discover] ${searchId}: repaired.`);
    }
  }
  if (!apply) {
    console.info("[repair-discover] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error("[repair-discover] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
