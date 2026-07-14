// Pure view logic for the Sequences dashboard (/campaigns): status flags,
// overlapping filter predicates with counts, search matching, and the
// 5-per-page pagination slices. Free of React and Prisma so every rule is
// unit-testable in the node test environment.

export type SequenceListItem = {
  id: string;
  name: string;
  campaignStatus: string;
  latestRunStatus: string | null;
  listName: string;
  templateName: string;
  senderName: string;
  senderEmail: string;
  enrolledCount: number;
  healthPercent: number | null;
  progressPercent: number;
  issueCount: number;
};

export type SequenceStatusFlags = {
  active: boolean;
  paused: boolean;
  attention: boolean;
  completed: boolean;
  scheduled: boolean;
  draft: boolean;
};

const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "WAITING_FOR_SLOT", "RUNNING"]);

export function getSequenceStatusFlags(item: SequenceListItem): SequenceStatusFlags {
  const run = item.latestRunStatus ?? "";

  return {
    active:
      item.campaignStatus === "RUNNING" ||
      item.campaignStatus === "WAITING_FOR_SLOT" ||
      ACTIVE_RUN_STATUSES.has(run),
    paused: item.campaignStatus === "PAUSED" || run === "PAUSED",
    attention: item.campaignStatus === "FAILED" || run === "FAILED" || item.issueCount > 0,
    completed: item.campaignStatus === "COMPLETED" || run === "COMPLETED",
    scheduled: item.campaignStatus === "SCHEDULED" || item.campaignStatus === "VALIDATED",
    draft: item.campaignStatus === "DRAFT"
  };
}

export type SequenceTone =
  | "attention"
  | "paused"
  | "active"
  | "completed"
  | "scheduled"
  | "draft"
  | "idle";

export const SEQUENCE_TONE_LABELS: Record<SequenceTone, string> = {
  attention: "Needs attention",
  paused: "Paused",
  active: "Active",
  completed: "Completed",
  scheduled: "Scheduled",
  draft: "Draft",
  idle: "Idle"
};

// One tone per sequence for the status pill and page previews. The order is a
// priority: a completed run with failures still reads "Needs attention".
export function primarySequenceTone(item: SequenceListItem): SequenceTone {
  const flags = getSequenceStatusFlags(item);

  if (flags.attention) return "attention";
  if (flags.paused) return "paused";
  if (flags.active) return "active";
  if (flags.completed) return "completed";
  if (flags.scheduled) return "scheduled";
  if (flags.draft) return "draft";
  return "idle";
}

export const SEQUENCE_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "attention", label: "Needs attention" },
  { id: "completed", label: "Completed" },
  { id: "scheduled", label: "Scheduled" },
  { id: "draft", label: "Draft" }
] as const;

export type SequenceFilterId = (typeof SEQUENCE_FILTERS)[number]["id"];

// Filters are overlapping predicates, not exclusive buckets: a completed
// sequence with failed sends appears under both Completed and Needs attention.
export function sequenceMatchesFilter(item: SequenceListItem, filterId: SequenceFilterId): boolean {
  if (filterId === "all") {
    return true;
  }

  return getSequenceStatusFlags(item)[filterId];
}

export function countSequenceFilters(
  items: readonly SequenceListItem[]
): Record<SequenceFilterId, number> {
  const counts: Record<SequenceFilterId, number> = {
    all: items.length,
    active: 0,
    paused: 0,
    attention: 0,
    completed: 0,
    scheduled: 0,
    draft: 0
  };

  for (const item of items) {
    const flags = getSequenceStatusFlags(item);
    if (flags.active) counts.active += 1;
    if (flags.paused) counts.paused += 1;
    if (flags.attention) counts.attention += 1;
    if (flags.completed) counts.completed += 1;
    if (flags.scheduled) counts.scheduled += 1;
    if (flags.draft) counts.draft += 1;
  }

  return counts;
}

export function normalizeSequenceQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function sequenceMatchesSearch(item: SequenceListItem, query: string): boolean {
  const normalized = normalizeSequenceQuery(query);

  if (!normalized) {
    return true;
  }

  return [item.name, item.listName, item.templateName, item.senderName, item.senderEmail].some(
    (value) => value.toLowerCase().includes(normalized)
  );
}

export function filterSequenceItems(
  items: readonly SequenceListItem[],
  filterId: SequenceFilterId,
  query: string
): SequenceListItem[] {
  return items.filter(
    (item) => sequenceMatchesFilter(item, filterId) && sequenceMatchesSearch(item, query)
  );
}

export const SEQUENCE_PAGE_SIZE = 5;

export type SequencePageSlice = {
  page: number;
  totalPages: number;
  pageItems: SequenceListItem[];
  rangeLabel: string;
};

export function paginateSequenceItems(
  items: readonly SequenceListItem[],
  requestedPage: number,
  pageSize: number = SEQUENCE_PAGE_SIZE
): SequencePageSlice {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const rangeLabel = items.length
    ? `Showing ${start + 1}–${start + pageItems.length} of ${items.length}`
    : "No sequences to show";

  return { page, totalPages, pageItems, rangeLabel };
}

const PREVIEW_TONE_ORDER: readonly SequenceTone[] = [
  "attention",
  "paused",
  "active",
  "completed",
  "scheduled",
  "draft",
  "idle"
];

export type SequencePagePreview = {
  headline: string;
  breakdown: string;
};

// Compact summary of the page a prev/next hover would land on, e.g.
// "5 sequences" + "3 completed · 1 paused · 1 needs attention".
export function describeSequencePagePreview(
  pageItems: readonly SequenceListItem[]
): SequencePagePreview | null {
  if (!pageItems.length) {
    return null;
  }

  const counts = new Map<SequenceTone, number>();

  for (const item of pageItems) {
    const tone = primarySequenceTone(item);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  const breakdown = PREVIEW_TONE_ORDER.filter((tone) => counts.has(tone))
    .map((tone) => `${counts.get(tone)} ${SEQUENCE_TONE_LABELS[tone].toLowerCase()}`)
    .join(" · ");

  return {
    headline: `${pageItems.length} sequence${pageItems.length === 1 ? "" : "s"}`,
    breakdown
  };
}
