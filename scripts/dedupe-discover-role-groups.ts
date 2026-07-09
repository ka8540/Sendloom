/**
 * Repair duplicate Discover role groups.
 *
 *   npx tsx scripts/dedupe-discover-role-groups.ts            # dry run (default)
 *   npx tsx scripts/dedupe-discover-role-groups.ts --dry-run  # explicit dry run
 *   npx tsx scripts/dedupe-discover-role-groups.ts --apply    # write changes
 *   npx tsx scripts/dedupe-discover-role-groups.ts --apply --user <userId>
 *
 * Re-running Discover for a company+role a user already searched creates a
 * second READY ProspectSearch, so the "Add more people" chooser (and any
 * per-search role listing) can show the same role twice. This safely folds each
 * set of duplicate READY searches that share a canonical role group (same user +
 * resolved company + normalized roles + normalized locations — see
 * discover-role-group-key) into ONE canonical search:
 *
 *   - the OLDEST search in the group is kept (the original);
 *   - each duplicate's people are reparented onto the canonical — a person the
 *     canonical already holds is dropped so it is never duplicated;
 *   - each duplicate's "Add 10 more" history is reparented onto the canonical;
 *   - the now-empty duplicate ProspectSearch rows are deleted (their materialized
 *     ProspectPerson rows are preserved — people are company-scoped and still
 *     granted via the canonical or another search);
 *   - the canonical's totalProcessed is recomputed from its merged grants.
 *
 * Different users, companies, roles, and locations are NEVER merged. The shared
 * DiscoverSearchCache pool is never touched. Idempotent: a second --apply run
 * finds nothing to do. Dry run by default; prints only ids and counts.
 */
import { prisma } from "@/lib/db";
import {
  planRoleGroupDedupe,
  type DedupeGroupPlan,
  type DedupeSearchInput
} from "@/services/prospects/dedupe-discover-role-groups";

function parseArgs(argv: string[]): { apply: boolean; userId: string | null } {
  const userIndex = argv.indexOf("--user");
  return {
    apply: argv.includes("--apply"),
    userId: userIndex >= 0 ? (argv[userIndex + 1] ?? "").trim() || null : null
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function loadSearches(userId: string | null): Promise<DedupeSearchInput[]> {
  const rows = await prisma.prospectSearch.findMany({
    // companyId must be resolved for a search to have a shared role-group
    // identity; a null-company search is never a duplicate group.
    where: { status: "READY", companyId: { not: null }, ...(userId ? { userId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });

  const searchIds = rows.map((row) => row.id);
  const [allocations, expansions] = await Promise.all([
    prisma.prospectSearchPerson.findMany({
      where: { searchId: { in: searchIds } },
      select: { searchId: true, personId: true }
    }),
    prisma.discoverSearchExpansion.findMany({
      where: { searchId: { in: searchIds } },
      select: { searchId: true }
    })
  ]);

  const peopleBySearch = new Map<string, string[]>();
  for (const row of allocations) {
    const list = peopleBySearch.get(row.searchId);
    if (list) {
      list.push(row.personId);
    } else {
      peopleBySearch.set(row.searchId, [row.personId]);
    }
  }
  const withExpansions = new Set(expansions.map((row) => row.searchId));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    companyId: row.companyId,
    requestedTitles: asStringArray(row.requestedTitles),
    requestedLocations: asStringArray(row.requestedLocations),
    status: row.status,
    createdAt: row.createdAt,
    allocationPersonIds: peopleBySearch.get(row.id) ?? [],
    hasExpansions: withExpansions.has(row.id)
  }));
}

async function applyGroup(group: DedupeGroupPlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const dup of group.duplicates) {
      // Move people the canonical does not already hold (no unique collision:
      // these personIds are absent from the canonical by construction).
      if (dup.reparentPersonIds.length > 0) {
        await tx.prospectSearchPerson.updateMany({
          where: { searchId: dup.searchId, personId: { in: dup.reparentPersonIds } },
          data: { searchId: group.canonicalId }
        });
      }
      // Drop grants the canonical already holds — the person stays materialized.
      if (dup.dropPersonIds.length > 0) {
        await tx.prospectSearchPerson.deleteMany({
          where: { searchId: dup.searchId, personId: { in: dup.dropPersonIds } }
        });
      }
      // Preserve Add-More history by reparenting expansions onto the canonical.
      // A generated idempotencyKey is effectively unique per expansion, so a
      // collision is virtually impossible; if one exists, keep the canonical's.
      if (dup.hasExpansions) {
        const expansions = await tx.discoverSearchExpansion.findMany({ where: { searchId: dup.searchId } });
        for (const expansion of expansions) {
          const clash = await tx.discoverSearchExpansion.findUnique({
            where: { searchId_idempotencyKey: { searchId: group.canonicalId, idempotencyKey: expansion.idempotencyKey } }
          });
          if (clash) {
            await tx.discoverSearchExpansion.delete({ where: { id: expansion.id } });
          } else {
            await tx.discoverSearchExpansion.update({
              where: { id: expansion.id },
              data: { searchId: group.canonicalId }
            });
          }
        }
      }
      // Any leftover grants cascade-delete with the row; references are moved.
      await tx.prospectSearch.delete({ where: { id: dup.searchId } });
    }
    await tx.prospectSearch.update({
      where: { id: group.canonicalId },
      data: { totalProcessed: group.canonicalTotalProcessed }
    });
  });
}

async function main(): Promise<void> {
  const { apply, userId } = parseArgs(process.argv.slice(2));
  console.info(
    `[dedupe-role-groups] ${apply ? "APPLY" : "DRY RUN"}${userId ? ` for user ${userId}` : " (all users)"}.`
  );

  const searches = await loadSearches(userId);
  const { groups, summary } = planRoleGroupDedupe(searches);

  for (const group of groups) {
    console.info(
      `[dedupe-role-groups] company ${group.companyId}: keep ${group.canonicalId}, ` +
        `merge ${group.duplicates.length} duplicate search(es) → ${group.canonicalTotalProcessed} people ` +
        `(${group.duplicates.reduce((sum, d) => sum + d.reparentPersonIds.length, 0)} moved, ` +
        `${group.duplicates.reduce((sum, d) => sum + d.dropPersonIds.length, 0)} already present).`
    );
    if (apply) {
      await applyGroup(group);
      console.info(`[dedupe-role-groups] company ${group.companyId}: merged.`);
    }
  }

  console.info(
    `[dedupe-role-groups] Summary: ${summary.duplicateGroups} duplicate group(s), ` +
      `${summary.searchesRemoved} search(es) ${apply ? "removed" : "to remove"}, ` +
      `${summary.peopleMoved} person grant(s) moved, ${summary.duplicatePeopleSkipped} duplicate person grant(s) skipped.`
  );
  if (!apply) {
    console.info("[dedupe-role-groups] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error("[dedupe-role-groups] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
