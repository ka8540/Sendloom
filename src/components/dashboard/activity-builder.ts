import type { Route } from "next";
import type { ImportStatus, RunStatus } from "@prisma/client";

import { formatCompactNumber, formatRelativeTime, humanizeEnum } from "@/components/dashboard/formatters";
import type { ActivityItem } from "@/components/dashboard/types";

// How many rows the Recent Activity feed renders. Unchanged from the original
// inline builder — all sources (existing and new) compete for these slots in
// reverse-chronological order.
const ACTIVITY_LIMIT = 7;

type SortableActivityItem = ActivityItem & { sortAt: number };

export type RecentRunInput = {
  id: string;
  status: RunStatus;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  invalidCount: number;
  totalRecipients: number;
  updatedAt: Date;
  campaign: {
    id: string;
    name: string;
  };
};

export type RecentImportInput = {
  id: string;
  fileName: string;
  rowCount: number;
  status: ImportStatus;
  updatedAt: Date;
};

export type RecentTemplateInput = {
  id: string;
  name: string;
  format: string;
  updatedAt: Date;
};

// A user-owned Discover search. The feed shows one row per search reflecting its
// current state, so re-reading or polling a READY search never produces a second
// "ready" entry — the dedup is inherent to deriving from current state.
export type RecentProspectSearchInput = {
  id: string;
  company: string;
  status: string;
  peopleCount: number;
  roleGroupCount: number;
  titles: string[];
  locations: string[];
  updatedAt: Date;
};

// One completed "Add 10 more" expansion. addedCount is the number of genuinely
// new (deduplicated) people; the durable expansion row is idempotency-keyed so a
// retried request reuses it rather than creating a second one.
export type RecentDiscoverExpansionInput = {
  id: string;
  company: string;
  searchId: string;
  addedCount: number;
  updatedAt: Date;
};

export type RecentDomainSearchInput = {
  id: string;
  domain: string;
  resultCount: number;
  updatedAt: Date;
};

// Audit-log rows for Finder/Discover actions that leave no durable domain record
// (individual email lookups, prepared exports). Only safe counters/labels are
// ever read from metadata — never email addresses or other contact details.
export type RecentActivityAuditInput = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: Date;
};

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function readMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function metadataString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(meta: Record<string, unknown>, key: string): number {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildRunItems(recentRuns: RecentRunInput[]): SortableActivityItem[] {
  return recentRuns.map((run) => {
    const issueCount = run.failedCount + run.suppressedCount + run.invalidCount;
    return {
      id: `run-${run.id}`,
      href: `/sequences/${run.campaign.id}` as Route,
      title:
        run.status === "RUNNING"
          ? `${run.campaign.name} is sending`
          : run.status === "FAILED"
            ? `${run.campaign.name} hit an issue`
            : `${run.campaign.name} updated`,
      description:
        run.totalRecipients > 0
          ? `${formatCompactNumber(run.sentCount)} sent, ${formatCompactNumber(issueCount)} issues across ${formatCompactNumber(run.totalRecipients)} recipients`
          : `${humanizeEnum(run.status)} run activity recorded.`,
      timeLabel: formatRelativeTime(run.updatedAt),
      timeValue: run.updatedAt.toISOString(),
      kind: "run",
      tone: run.status === "FAILED" ? "warning" : run.status === "RUNNING" ? "accent" : "success",
      sortAt: run.updatedAt.getTime()
    };
  });
}

function buildImportItems(recentImports: RecentImportInput[]): SortableActivityItem[] {
  return recentImports.map((entry) => ({
    id: `import-${entry.id}`,
    href: "/imports",
    title: `${entry.fileName} is ${entry.status === "PROCESSED" ? "ready" : humanizeEnum(entry.status).toLowerCase()}`,
    description:
      entry.status === "PROCESSED"
        ? `${formatCompactNumber(entry.rowCount)} rows are ready for mapping and launch.`
        : `Import status changed to ${humanizeEnum(entry.status).toLowerCase()}.`,
    timeLabel: formatRelativeTime(entry.updatedAt),
    timeValue: entry.updatedAt.toISOString(),
    kind: "import",
    tone: entry.status === "FAILED" ? "warning" : "muted",
    sortAt: entry.updatedAt.getTime()
  }));
}

function buildTemplateItems(recentTemplates: RecentTemplateInput[]): SortableActivityItem[] {
  return recentTemplates.map((entry) => ({
    id: `template-${entry.id}`,
    href: "/templates",
    title: `${entry.name} updated`,
    description: `${entry.format.toUpperCase()} copy refreshed and ready to reuse.`,
    timeLabel: formatRelativeTime(entry.updatedAt),
    timeValue: entry.updatedAt.toISOString(),
    kind: "template",
    tone: "muted",
    sortAt: entry.updatedAt.getTime()
  }));
}

function buildDiscoverSearchItems(searches: RecentProspectSearchInput[]): SortableActivityItem[] {
  const items: SortableActivityItem[] = [];

  for (const search of searches) {
    // User-aborted searches are not "meaningful completed work" — skip them.
    if (search.status === "CANCELED") {
      continue;
    }

    const base = {
      href: `/prospects/${search.id}` as Route,
      kind: "discover" as const,
      timeLabel: formatRelativeTime(search.updatedAt),
      timeValue: search.updatedAt.toISOString(),
      sortAt: search.updatedAt.getTime()
    };

    if (search.status === "READY") {
      const people = search.peopleCount;
      const groups = search.roleGroupCount;
      items.push({
        ...base,
        id: `discover-search-${search.id}`,
        title: `${search.company} results are ready`,
        description: `${formatCompactNumber(people)} ${pluralize(people, "professional", "professionals")} found across ${formatCompactNumber(groups)} ${pluralize(groups, "role group", "role groups")}.`,
        tone: "success",
        eventType: "discover_search_ready"
      });
      continue;
    }

    if (search.status === "FAILED") {
      items.push({
        ...base,
        id: `discover-search-${search.id}`,
        title: `${search.company} search needs attention`,
        // Deliberately generic: never expose provider names, raw error codes, or
        // internal messages here.
        description: "The Discover search could not be completed. Open it to retry.",
        tone: "warning",
        eventType: "discover_search_failed"
      });
      continue;
    }

    // DRAFT and the intermediate processing states all read as "created" — the
    // search has been prepared and the row upgrades to "ready" once it completes.
    const roleSummary =
      search.titles.length === 0
        ? "requested roles"
        : search.titles.length === 1
          ? search.titles[0]
          : `${search.titles.length} requested roles`;
    const location = search.locations[0]?.trim();
    items.push({
      ...base,
      id: `discover-search-${search.id}`,
      title: `${search.company} search created`,
      description: location
        ? `Discover search prepared for ${roleSummary} in ${location}.`
        : `Discover search prepared for ${roleSummary}.`,
      tone: "muted",
      eventType: "discover_search_created"
    });
  }

  return items;
}

function buildDiscoverExpansionItems(expansions: RecentDiscoverExpansionInput[]): SortableActivityItem[] {
  const items: SortableActivityItem[] = [];

  for (const expansion of expansions) {
    // Only genuinely-new people count; a zero-add expansion is not a completed
    // action worth surfacing.
    if (expansion.addedCount <= 0) {
      continue;
    }

    items.push({
      id: `discover-expansion-${expansion.id}`,
      href: `/prospects/${expansion.searchId}` as Route,
      title: `More people added to ${expansion.company}`,
      description: `${formatCompactNumber(expansion.addedCount)} new ${pluralize(expansion.addedCount, "professional was", "professionals were")} added to the Discover results.`,
      timeLabel: formatRelativeTime(expansion.updatedAt),
      timeValue: expansion.updatedAt.toISOString(),
      kind: "discover",
      tone: "muted",
      eventType: "discover_people_added",
      sortAt: expansion.updatedAt.getTime()
    });
  }

  return items;
}

function buildDomainSearchItems(domainSearches: RecentDomainSearchInput[]): SortableActivityItem[] {
  const items: SortableActivityItem[] = [];

  for (const search of domainSearches) {
    // An empty domain search is not a successful result event.
    if (search.resultCount <= 0) {
      continue;
    }

    items.push({
      id: `finder-domain-${search.id}`,
      href: "/finder",
      title: `${search.domain} Finder search completed`,
      description: `${formatCompactNumber(search.resultCount)} work-email ${pluralize(search.resultCount, "result was", "results were")} returned.`,
      timeLabel: formatRelativeTime(search.updatedAt),
      timeValue: search.updatedAt.toISOString(),
      kind: "finder",
      tone: "muted",
      eventType: "finder_domain_search",
      sortAt: search.updatedAt.getTime()
    });
  }

  return items;
}

function buildAuditItems(events: RecentActivityAuditInput[]): SortableActivityItem[] {
  const items: SortableActivityItem[] = [];

  for (const event of events) {
    const meta = readMetadata(event.metadata);

    if (event.action === "hunter.email_search") {
      // Only successful, non-empty lookups are completed work. The discovered
      // email address is never present in audit metadata and is never rendered.
      if (meta.found !== true) {
        continue;
      }
      const domain = metadataString(meta, "domain") ?? "the requested company";
      items.push({
        id: `finder-email-${event.id}`,
        href: "/finder",
        title: "Finder located a work email",
        description: `A work email result was found for ${domain}.`,
        timeLabel: formatRelativeTime(event.createdAt),
        timeValue: event.createdAt.toISOString(),
        kind: "finder",
        tone: "muted",
        eventType: "finder_email_found",
        sortAt: event.createdAt.getTime()
      });
      continue;
    }

    if (event.action === "discover.results_exported") {
      const company = metadataString(meta, "company") ?? "Discover";
      const selectedCount = metadataNumber(meta, "selectedCount");
      items.push({
        id: `discover-export-${event.id}`,
        href: "/prospects",
        title: `${company} contacts exported`,
        description: `${formatCompactNumber(selectedCount)} selected ${pluralize(selectedCount, "contact was", "contacts were")} exported to a spreadsheet.`,
        timeLabel: formatRelativeTime(event.createdAt),
        timeValue: event.createdAt.toISOString(),
        kind: "discover",
        tone: "muted",
        eventType: "discover_results_exported",
        sortAt: event.createdAt.getTime()
      });
    }
  }

  return items;
}

export function buildActivityItems({
  recentRuns,
  recentImports,
  recentTemplates,
  recentProspectSearches = [],
  recentDiscoverExpansions = [],
  recentDomainSearches = [],
  recentActivityAuditEvents = []
}: {
  recentRuns: RecentRunInput[];
  recentImports: RecentImportInput[];
  recentTemplates: RecentTemplateInput[];
  recentProspectSearches?: RecentProspectSearchInput[];
  recentDiscoverExpansions?: RecentDiscoverExpansionInput[];
  recentDomainSearches?: RecentDomainSearchInput[];
  recentActivityAuditEvents?: RecentActivityAuditInput[];
}): ActivityItem[] {
  const sortableItems: SortableActivityItem[] = [
    ...buildRunItems(recentRuns),
    ...buildImportItems(recentImports),
    ...buildTemplateItems(recentTemplates),
    ...buildDiscoverSearchItems(recentProspectSearches),
    ...buildDiscoverExpansionItems(recentDiscoverExpansions),
    ...buildDomainSearchItems(recentDomainSearches),
    ...buildAuditItems(recentActivityAuditEvents)
  ];

  return sortableItems
    .sort((left, right) => right.sortAt - left.sortAt)
    .slice(0, ACTIVITY_LIMIT)
    .map(({ sortAt: _sortAt, ...item }) => item);
}
