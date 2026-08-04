export const ANALYSIS_MAX_RANGE_DAYS = 366;
export const ANALYSIS_MIN_RANKING_SENDS = 20;

export const analysisPages = ["overview", "engagement", "sequences", "reliability", "senders"] as const;
export type AnalysisPage = (typeof analysisPages)[number];

export type AnalysisRange = {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
  previousStart: Date;
  previousEndExclusive: Date;
  days: number;
  label: string;
};

export type MetricComparison = {
  label: string;
  direction: "up" | "down" | "flat" | "neutral";
};

export type AnalysisFailureClassification = {
  category:
    | "Invalid recipient"
    | "Gmail temporary failure"
    | "Rate limited"
    | "Suppressed"
    | "Sender disconnected"
    | "Missing variables"
    | "Permanent provider rejection"
    | "Attachment or storage issue"
    | "Unknown";
  disposition: "retryable" | "permanent" | "suppressed" | "pacing";
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string | null | undefined) {
  if (!value || !DATE_KEY_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || toUtcDateKey(date) !== value ? null : date;
}

function formatRangeLabel(start: Date, inclusiveEnd: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: start.getUTCFullYear() === inclusiveEnd.getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC"
  });
  const endFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });

  return `${formatter.format(start)} – ${endFormatter.format(inclusiveEnd)}`;
}

/**
 * Normalize an inclusive, UTC calendar-day Analysis range. Invalid, reversed,
 * or overlong custom ranges fall back to the latest seven UTC calendar days.
 */
export function normalizeAnalysisDateRange(
  input: { from?: string | null; to?: string | null },
  now = new Date()
): AnalysisRange {
  const today = startOfUtcDay(now);
  const fallbackStart = new Date(today.getTime() - 6 * DAY_MS);
  const requestedStart = parseDateKey(input.from);
  const requestedEnd = parseDateKey(input.to);
  let start = requestedStart ?? fallbackStart;
  let inclusiveEnd = requestedEnd ?? today;
  const requestedDays = Math.floor((inclusiveEnd.getTime() - start.getTime()) / DAY_MS) + 1;

  if (requestedDays < 1 || requestedDays > ANALYSIS_MAX_RANGE_DAYS) {
    start = fallbackStart;
    inclusiveEnd = today;
  }

  const days = Math.floor((inclusiveEnd.getTime() - start.getTime()) / DAY_MS) + 1;
  const endExclusive = new Date(inclusiveEnd.getTime() + DAY_MS);
  const previousEndExclusive = new Date(start);
  const previousStart = new Date(previousEndExclusive.getTime() - days * DAY_MS);

  return {
    from: toUtcDateKey(start),
    to: toUtcDateKey(inclusiveEnd),
    start,
    endExclusive,
    previousStart,
    previousEndExclusive,
    days,
    label: formatRangeLabel(start, inclusiveEnd)
  };
}

export function enumerateUtcDateKeys(start: Date, endExclusive: Date) {
  const keys: string[] = [];
  for (let cursor = start.getTime(); cursor < endExclusive.getTime(); cursor += DAY_MS) {
    keys.push(toUtcDateKey(new Date(cursor)));
  }
  return keys;
}

export function roundRate(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function calculateRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return roundRate((numerator / denominator) * 100);
}

export function analysisConfirmedSendKey(entry: { id: string; recipientJobId?: string | null }) {
  return entry.recipientJobId ? `job:${entry.recipientJobId}` : `ledger:${entry.id}`;
}

export function countUniqueConfirmedSends(entries: Array<{ id: string; recipientJobId?: string | null }>) {
  return new Set(entries.map(analysisConfirmedSendKey)).size;
}

export function countUniqueMatchedReplies(
  sentRecipientJobIds: Iterable<string>,
  replies: Array<{ recipientJobId?: string | null }>
) {
  const sent = new Set(sentRecipientJobIds);
  return new Set(
    replies.flatMap((reply) => (reply.recipientJobId && sent.has(reply.recipientJobId) ? [reply.recipientJobId] : []))
  ).size;
}

export function meetsAnalysisRankingMinimum(sent: number) {
  return sent >= ANALYSIS_MIN_RANKING_SENDS;
}

export function buildCountComparison(current: number, previous: number): MetricComparison {
  if (previous === 0) {
    return current > 0
      ? { label: "New activity", direction: "up" }
      : { label: "No prior data", direction: "neutral" };
  }

  const change = roundRate(((current - previous) / previous) * 100);
  if (change === 0) {
    return { label: "Flat vs prior period", direction: "flat" };
  }

  return {
    label: `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs prior period`,
    direction: change > 0 ? "up" : "down"
  };
}

export function buildRateComparison(current: number, previous: number): MetricComparison {
  if (current === 0 && previous === 0) {
    return { label: "No prior data", direction: "neutral" };
  }

  const change = roundRate(current - previous);
  if (change === 0) {
    return { label: "Flat vs prior period", direction: "flat" };
  }

  return {
    label: `${change > 0 ? "+" : ""}${change.toFixed(1)} pp vs prior period`,
    direction: change > 0 ? "up" : "down"
  };
}

export function normalizeAnalysisScheduleType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "once" || normalized === "recurring") {
    return normalized;
  }
  return "immediate";
}

export function readAnalysisMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  return typeof metadata[key] === "string" ? String(metadata[key]) : "";
}

export function classifyAnalysisFailure(input: {
  status: string;
  metadata?: unknown;
  lastError?: string | null;
}): AnalysisFailureClassification | null {
  const metadata = readAnalysisMetadata(input.metadata);
  const internalError = readAnalysisMetadata(metadata.lastInternalError);
  const blockedBy = metadataString(metadata, "blockedBy");
  const failureCode = (
    metadataString(metadata, "failureCode") ||
    metadataString(metadata, "failureCategory") ||
    metadataString(internalError, "failureCode")
  ).toUpperCase();
  const inspectionText = [
    failureCode,
    metadataString(metadata, "providerErrorReason"),
    metadataString(metadata, "providerErrorStatus"),
    input.lastError ?? ""
  ]
    .join(" ")
    .toUpperCase();

  if (["DAILY_SEND_LIMIT", "GMAIL_SENDER_LIMIT", "GMAIL_SENDER_PACING"].includes(blockedBy)) {
    return { category: "Rate limited", disposition: "pacing" };
  }

  if (input.status === "SUPPRESSED") {
    return { category: "Suppressed", disposition: "suppressed" };
  }

  if (input.status === "INVALID" || /INVALID|HARD_BOUNCE_RECIPIENT|ADDRESS_NOT_FOUND/.test(inspectionText)) {
    return { category: "Invalid recipient", disposition: "permanent" };
  }

  if (/MISSING_VARIABLE|TEMPLATE_VARIABLE|MAPPING/.test(inspectionText)) {
    return { category: "Missing variables", disposition: "permanent" };
  }

  if (/GMAIL_PROFILE_DISCONNECTED|GMAIL_TOKEN_EXPIRED|GMAIL_REFRESH_FAILED|RECONNECT/.test(inspectionText)) {
    return { category: "Sender disconnected", disposition: "permanent" };
  }

  if (/ATTACHMENT|STORAGE/.test(inspectionText)) {
    return { category: "Attachment or storage issue", disposition: "permanent" };
  }

  if (/GMAIL_RATE_LIMITED|RATE_LIMIT/.test(inspectionText)) {
    return { category: "Rate limited", disposition: "retryable" };
  }

  if (/GMAIL_TEMPORARY_FAILURE|QUEUE_PROCESSING_FAILED|DATABASE_UNAVAILABLE|DATABASE_WRITE_FAILED/.test(inspectionText)) {
    return { category: "Gmail temporary failure", disposition: "retryable" };
  }

  if (input.status === "RETRYING" || metadata.retryable === true) {
    return { category: "Gmail temporary failure", disposition: "retryable" };
  }

  if (input.status === "BOUNCED" || input.status === "COMPLAINED" || /GMAIL_SEND_REJECTED|PERMANENT/.test(inspectionText)) {
    return { category: "Permanent provider rejection", disposition: "permanent" };
  }

  if (input.status === "FAILED") {
    return { category: "Unknown", disposition: "permanent" };
  }

  return null;
}

export function isAnalysisPage(value: string): value is AnalysisPage {
  return analysisPages.includes(value as AnalysisPage);
}
