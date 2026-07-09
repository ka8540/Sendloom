// Pure planning for the duplicate-role-group repair (see
// scripts/dedupe-discover-role-groups.ts). Given a user's READY Discover
// searches — each with the people it has allocated and whether it carries
// Add-More history — this decides, per canonical role group, which search to
// KEEP and how to fold the duplicates into it. No I/O here so the merge logic is
// unit-testable under the node-only vitest setup; the script does the DB writes.
//
// Rules (mirrors discover-role-group-key):
//   - Only searches with a resolved companyId group (an unresolved search has no
//     shared identity). Different user / company / role / location never merge.
//   - Only READY searches merge: they are the ones that surface as duplicate
//     role-group options. Non-READY siblings are left untouched.
//   - The canonical keeper is the OLDEST search in the group (the original the
//     user first ran), tie-broken by id — so "reuse the existing group" holds.
//   - A duplicate's people are reparented onto the canonical; a person the
//     canonical already holds is dropped (never duplicated). Duplicate searches
//     are removed only after their references move.

import { discoverRoleGroupKey } from "@/services/prospects/discover-role-group-key";

export type DedupeSearchInput = {
  id: string;
  userId: string;
  companyId: string | null;
  requestedTitles: string[];
  requestedLocations: string[];
  status: string;
  createdAt: Date;
  /** personIds this search has granted (ProspectSearchPerson rows). */
  allocationPersonIds: string[];
  /** Whether the search has any DiscoverSearchExpansion (Add-More) history. */
  hasExpansions: boolean;
};

export type DedupeDuplicatePlan = {
  searchId: string;
  /** People to move onto the canonical (not already granted there). */
  reparentPersonIds: string[];
  /** Grants to delete because the canonical already holds that person. */
  dropPersonIds: string[];
  /** Move this duplicate's Add-More history onto the canonical before removal. */
  hasExpansions: boolean;
};

export type DedupeGroupPlan = {
  groupKey: string;
  userId: string;
  companyId: string;
  canonicalId: string;
  duplicates: DedupeDuplicatePlan[];
  /** Distinct people the canonical will hold after the merge. */
  canonicalTotalProcessed: number;
};

export type DedupeSummary = {
  duplicateGroups: number;
  searchesRemoved: number;
  peopleMoved: number;
  duplicatePeopleSkipped: number;
};

export type DedupePlan = {
  groups: DedupeGroupPlan[];
  summary: DedupeSummary;
};

/** Oldest first (the original), tie-broken by id for determinism. */
function byOldest(a: DedupeSearchInput, b: DedupeSearchInput): number {
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  return at - bt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Build the dedupe plan. Only groups with more than one READY search for the
 * same canonical role-group key appear; a lone search is never touched. Idempotent
 * by construction: after applying, each group has a single search and re-planning
 * finds nothing to do.
 */
export function planRoleGroupDedupe(searches: DedupeSearchInput[]): DedupePlan {
  const buckets = new Map<string, DedupeSearchInput[]>();
  for (const search of searches) {
    if (search.status !== "READY") {
      continue;
    }
    const key = discoverRoleGroupKey(search);
    if (!key) {
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(search);
    } else {
      buckets.set(key, [search]);
    }
  }

  const groups: DedupeGroupPlan[] = [];
  const summary: DedupeSummary = {
    duplicateGroups: 0,
    searchesRemoved: 0,
    peopleMoved: 0,
    duplicatePeopleSkipped: 0
  };

  for (const [groupKey, bucket] of buckets) {
    if (bucket.length < 2) {
      continue;
    }
    const ordered = [...bucket].sort(byOldest);
    const canonical = ordered[0];
    const canonicalPeople = new Set(canonical.allocationPersonIds);

    const duplicates: DedupeDuplicatePlan[] = [];
    for (const dup of ordered.slice(1)) {
      const reparentPersonIds: string[] = [];
      const dropPersonIds: string[] = [];
      // Dedupe within the duplicate itself too, so a person granted twice never
      // reparents twice.
      for (const personId of new Set(dup.allocationPersonIds)) {
        if (canonicalPeople.has(personId)) {
          dropPersonIds.push(personId);
        } else {
          canonicalPeople.add(personId);
          reparentPersonIds.push(personId);
        }
      }
      duplicates.push({
        searchId: dup.id,
        reparentPersonIds,
        dropPersonIds,
        hasExpansions: dup.hasExpansions
      });
      summary.peopleMoved += reparentPersonIds.length;
      summary.duplicatePeopleSkipped += dropPersonIds.length;
    }

    summary.duplicateGroups += 1;
    summary.searchesRemoved += duplicates.length;
    groups.push({
      groupKey,
      userId: canonical.userId,
      companyId: canonical.companyId as string,
      canonicalId: canonical.id,
      duplicates,
      canonicalTotalProcessed: canonicalPeople.size
    });
  }

  // Stable output order for deterministic dry-run logs.
  groups.sort((a, b) => (a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0));
  return { groups, summary };
}
