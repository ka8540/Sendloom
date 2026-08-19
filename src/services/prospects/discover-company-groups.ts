// Pure grouping of a user's Discover searches into one dashboard entry per
// materialized company.
//
// This is a PRESENTATION read model only. Grouping never merges the underlying
// ProspectSearch records — each child search keeps its own requested roles,
// location, timestamps, status, usage event, allocation grants, and Add-More
// history. The group key is the search's resolved `companyId`: company
// resolution already normalizes "Walmart" / "Walmart Inc." / walmart.com to one
// user-owned ProspectCompany (unique per userId + normalizedName), and distinct
// companies/domains resolve to distinct ids, so unrelated companies can never
// group by display-name similarity. A search that has no resolved company yet
// (draft / processing / failed before resolution) stays its own single-search
// entry keyed by its search id.
//
// Timestamp rule (documented): a group's `latestActivityAt` is the MAX of
// `updatedAt` (falling back to `createdAt`) across its child searches — i.e.
// the latest relevant activity, never an arbitrary child's date.

export type GroupableSearch = {
  id: string;
  companyId: string | null;
  requestedCompany: string;
  requestedTitles: unknown;
  requestedLocations: unknown;
  totalProcessed: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DiscoverCompanyGroupNode<T extends GroupableSearch = GroupableSearch> = {
  /** companyId for resolved groups; the search id for single-search fallbacks. */
  id: string;
  companyId: string | null;
  /** The owner — used by field resolvers to keep count queries user-scoped. */
  userId: string;
  /** Fallback label when the company row is unavailable to the client. */
  displayName: string;
  /** Successful role labels, or newest-attempt context when none succeeded. */
  requestedRoles: string[];
  /** Successful locations, or newest-attempt context when none succeeded. */
  locations: string[];
  /** Child searches, newest first. */
  searches: T[];
  latestActivityAt: Date;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function activityAt(search: GroupableSearch): number {
  const updated = search.updatedAt ? new Date(search.updatedAt).getTime() : Number.NaN;
  const created = search.createdAt ? new Date(search.createdAt).getTime() : 0;
  return Number.isFinite(updated) ? Math.max(updated, created) : created;
}

/** Dedupe labels case-insensitively while preserving the first-seen casing. */
function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(label.trim());
  }
  return result;
}

/**
 * Build the grouped dashboard entries for one user's searches. Input order does
 * not matter; children are sorted newest first inside each group and groups are
 * ordered by latest activity (newest first, id as a stable tiebreak).
 */
export function buildDiscoverCompanyGroups<T extends GroupableSearch>(
  userId: string,
  searches: T[]
): DiscoverCompanyGroupNode<T>[] {
  const byKey = new Map<string, T[]>();
  for (const search of searches) {
    const key = search.companyId ?? `search:${search.id}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(search);
    } else {
      byKey.set(key, [search]);
    }
  }

  const groups: DiscoverCompanyGroupNode<T>[] = [];
  for (const bucket of byKey.values()) {
    const children = [...bucket].sort((a, b) => activityAt(b) - activityAt(a) || (a.id < b.id ? 1 : -1));
    const latest = children[0];
    // Requested input is not proof that a role/location was added. Once a
    // company has at least one people-backed READY child, only those successful
    // children contribute the labels advertised by Search History. If every
    // child is unsuccessful, retain the newest non-canceled attempt as context
    // so a standalone No results/Failed row still says what the user searched.
    const successfulChildren = children.filter(
      (search) => search.status === "READY" && (search.totalProcessed ?? 0) > 0
    );
    const newestAttempt = children.find((search) => search.status !== "CANCELED") ?? latest;
    const labelSources = successfulChildren.length > 0 ? successfulChildren : [newestAttempt];
    groups.push({
      id: latest.companyId ?? latest.id,
      companyId: latest.companyId,
      userId,
      displayName: latest.requestedCompany,
      requestedRoles: dedupeLabels(labelSources.flatMap((search) => asStringArray(search.requestedTitles))),
      locations: dedupeLabels(labelSources.flatMap((search) => asStringArray(search.requestedLocations))),
      searches: children,
      latestActivityAt: new Date(activityAt(latest))
    });
  }

  return groups.sort(
    (a, b) => b.latestActivityAt.getTime() - a.latestActivityAt.getTime() || (a.id < b.id ? 1 : -1)
  );
}
