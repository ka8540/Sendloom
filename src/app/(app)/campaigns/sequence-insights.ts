// Pure presentation logic for the Sequences command center. Everything here is
// deterministic and node-testable: status-flag mapping from the real
// CampaignStatus/RunStatus enums, filter predicates and counts, trimmed
// case-insensitive search, 5-per-page pagination math, and the target-page
// preview summary shown when hovering the pagination controls.

export const SEQUENCE_PAGE_SIZE = 5;

export const SEQUENCE_FILTERS = [
  "all",
  "active",
  "paused",
  "attention",
  "completed",
  "scheduled",
  "draft"
] as const;

export type SequenceFilterKey = (typeof SEQUENCE_FILTERS)[number];

export type SequenceStatusFlags = {
  active: boolean;
  paused: boolean;
  needsAttention: boolean;
  completed: boolean;
  scheduled: boolean;
  draft: boolean;
};

export type SequenceToneKey =
  | "attention"
  | "paused"
  | "active"
  | "completed"
  | "scheduled"
  | "draft"
  | "idle";

// Campaign statuses that mean work is queued or in flight right now.
const ACTIVE_CAMPAIGN_STATUSES = new Set(["RUNNING", "WAITING_FOR_SLOT"]);
// Run statuses that mean the latest run is queued or in flight.
const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "WAITING_FOR_SLOT", "RUNNING"]);
// VALIDATED = ready to launch; SCHEDULED = queued on a timer.
const SCHEDULED_READY_STATUSES = new Set(["SCHEDULED", "VALIDATED"]);

export function computeSequenceFlags(input: {
  status: string;
  latestRunStatus: string | null;
  issueCount: number;
}): SequenceStatusFlags {
  const latestRunStatus = input.latestRunStatus ?? "";

  return {
    active: ACTIVE_CAMPAIGN_STATUSES.has(input.status) || ACTIVE_RUN_STATUSES.has(latestRunStatus),
    paused: input.status === "PAUSED" || latestRunStatus === "PAUSED",
    needsAttention: input.status === "FAILED" || latestRunStatus === "FAILED" || input.issueCount > 0,
    completed: input.status === "COMPLETED" || latestRunStatus === "COMPLETED",
    scheduled: SCHEDULED_READY_STATUSES.has(input.status),
    draft: input.status === "DRAFT"
  };
}

// Filters are predicates, not exclusive buckets — a completed sequence with
// failed sends appears under both Completed and Needs attention, matching how
// operators actually triage.
export function sequenceMatchesFilter(
  sequence: { flags: SequenceStatusFlags },
  filter: SequenceFilterKey
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return sequence.flags.active;
    case "paused":
      return sequence.flags.paused;
    case "attention":
      return sequence.flags.needsAttention;
    case "completed":
      return sequence.flags.completed;
    case "scheduled":
      return sequence.flags.scheduled;
    case "draft":
      return sequence.flags.draft;
  }
}

export type SequenceSearchFields = {
  name: string;
  listName: string;
  templateName: string;
  senderName: string;
  senderEmail: string;
};

export function normalizeSequenceQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function sequenceMatchesQuery(sequence: SequenceSearchFields, rawQuery: string): boolean {
  const query = normalizeSequenceQuery(rawQuery);

  if (!query) {
    return true;
  }

  return [
    sequence.name,
    sequence.listName,
    sequence.templateName,
    sequence.senderName,
    sequence.senderEmail
  ].some((field) => field.toLowerCase().includes(query));
}

export function filterSequences<T extends SequenceSearchFields & { flags: SequenceStatusFlags }>(
  sequences: readonly T[],
  filter: SequenceFilterKey,
  rawQuery: string
): T[] {
  return sequences.filter(
    (sequence) => sequenceMatchesFilter(sequence, filter) && sequenceMatchesQuery(sequence, rawQuery)
  );
}

export function countSequencesByFilter(
  sequences: readonly { flags: SequenceStatusFlags }[]
): Record<SequenceFilterKey, number> {
  const counts: Record<SequenceFilterKey, number> = {
    all: sequences.length,
    active: 0,
    paused: 0,
    attention: 0,
    completed: 0,
    scheduled: 0,
    draft: 0
  };

  for (const sequence of sequences) {
    if (sequence.flags.active) counts.active += 1;
    if (sequence.flags.paused) counts.paused += 1;
    if (sequence.flags.needsAttention) counts.attention += 1;
    if (sequence.flags.completed) counts.completed += 1;
    if (sequence.flags.scheduled) counts.scheduled += 1;
    if (sequence.flags.draft) counts.draft += 1;
  }

  return counts;
}

// One primary tone per sequence — used for the card status dot and for the
// pagination preview so category counts always sum to the page size.
// Attention outranks everything because issues are what operators triage first.
export function primarySequenceTone(sequence: { flags: SequenceStatusFlags }): SequenceToneKey {
  const { flags } = sequence;

  if (flags.needsAttention) return "attention";
  if (flags.paused) return "paused";
  if (flags.active) return "active";
  if (flags.completed) return "completed";
  if (flags.scheduled) return "scheduled";
  if (flags.draft) return "draft";
  return "idle";
}

export type SequencePagination = {
  page: number;
  totalPages: number;
  start: number;
  end: number;
  rangeLabel: string;
};

export function getSequencePagination(
  totalCount: number,
  requestedPage: number,
  pageSize: number = SEQUENCE_PAGE_SIZE
): SequencePagination {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  const end = Math.min(totalCount, start + pageSize);

  return {
    page,
    totalPages,
    start,
    end,
    rangeLabel: totalCount === 0 ? "No sequences" : `Showing ${start + 1}–${end} of ${totalCount}`
  };
}

const TONE_SUMMARY_LABELS: Record<SequenceToneKey, [singular: string, plural: string]> = {
  attention: ["needs review", "need review"],
  paused: ["paused", "paused"],
  active: ["active", "active"],
  completed: ["completed", "completed"],
  scheduled: ["scheduled", "scheduled"],
  draft: ["draft", "drafts"],
  idle: ["idle", "idle"]
};

const TONE_SUMMARY_ORDER: SequenceToneKey[] = [
  "attention",
  "paused",
  "active",
  "completed",
  "scheduled",
  "draft",
  "idle"
];

// "2 completed · 1 paused · 2 need review" for the sequences on a target page.
export function summarizeSequencePage(
  sequences: readonly { flags: SequenceStatusFlags }[]
): string {
  const counts = new Map<SequenceToneKey, number>();

  for (const sequence of sequences) {
    const tone = primarySequenceTone(sequence);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }

  const parts = TONE_SUMMARY_ORDER.flatMap((tone) => {
    const count = counts.get(tone) ?? 0;
    if (count === 0) {
      return [];
    }
    const [singular, plural] = TONE_SUMMARY_LABELS[tone];
    return [`${count} ${count === 1 ? singular : plural}`];
  });

  return parts.join(" · ");
}

// Keep the selected sequence only while it is still visible; otherwise fall
// back to the first sequence on the current page (or nothing).
export function resolveSequenceSelection(
  visibleIds: readonly string[],
  selectedId: string | null
): string | null {
  if (selectedId && visibleIds.includes(selectedId)) {
    return selectedId;
  }

  return visibleIds[0] ?? null;
}
