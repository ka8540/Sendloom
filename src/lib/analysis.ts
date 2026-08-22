import {
  addAnalysisCalendarDays,
  analysisCalendarDayDifference,
  analysisLocalDateStartUtc,
  formatAnalysisDateKey,
  instantToAnalysisDateKey,
  normalizeAnalysisTimeZone,
  parseAnalysisDateKey
} from "@/lib/analysis-timezone";

/** Analysis supports two presets only. Longer periods are not queryable. */
export const ANALYSIS_PRESET_DAYS = [7, 30] as const;
export type AnalysisPresetDays = (typeof ANALYSIS_PRESET_DAYS)[number];
export const ANALYSIS_DEFAULT_DAYS: AnalysisPresetDays = 7;
export const ANALYSIS_MAX_RANGE_DAYS = 30;
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
  timeZone: string;
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

function isPresetDays(days: number): days is AnalysisPresetDays {
  return (ANALYSIS_PRESET_DAYS as readonly number[]).includes(days);
}

export function analysisPresetLabel(days: AnalysisPresetDays) {
  return `Last ${days} days`;
}

/** Absolute local-calendar span, e.g. "Jul 29 – Aug 4, 2026". */
export function formatAnalysisRangeLabel(from: string, to: string, timeZone: string) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = formatAnalysisDateKey(from, timeZone, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric"
  });
  const end = formatAnalysisDateKey(to, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  return `${start} – ${end}`;
}

export function analysisPresetRange(days: AnalysisPresetDays, timeZone: string, now = new Date()) {
  const zone = normalizeAnalysisTimeZone(timeZone);
  const to = instantToAnalysisDateKey(now, zone);
  return { from: addAnalysisCalendarDays(to, -(days - 1)), to };
}

/**
 * Normalize an inclusive local calendar-day Analysis range. Only the supported
 * presets are queryable: anything else — a reversed range, a future end date, an
 * arbitrary custom span, or a period longer than 30 days — falls back to the
 * latest seven local calendar days rather than running an unbounded query.
 */
export function normalizeAnalysisDateRange(
  input: { from?: string | null; to?: string | null },
  now = new Date(),
  timeZone = "UTC"
): AnalysisRange {
  const zone = normalizeAnalysisTimeZone(timeZone);
  const today = instantToAnalysisDateKey(now, zone);
  const requestedStart = parseAnalysisDateKey(input.from);
  const requestedEnd = parseAnalysisDateKey(input.to);
  const requestedDays =
    requestedStart && requestedEnd
      ? (analysisCalendarDayDifference(input.from as string, input.to as string) ?? -1) + 1
      : 0;
  const supported =
    requestedStart !== null &&
    requestedEnd !== null &&
    isPresetDays(requestedDays) &&
    (input.to as string) <= today;

  const inclusiveEnd = supported ? (input.to as string) : today;
  const days: AnalysisPresetDays = supported ? (requestedDays as AnalysisPresetDays) : ANALYSIS_DEFAULT_DAYS;
  const from = supported ? (input.from as string) : addAnalysisCalendarDays(inclusiveEnd, -(days - 1));
  const endExclusiveKey = addAnalysisCalendarDays(inclusiveEnd, 1);
  const previousEndExclusiveKey = from;
  const previousStartKey = addAnalysisCalendarDays(previousEndExclusiveKey, -days);

  return {
    from,
    to: inclusiveEnd,
    start: analysisLocalDateStartUtc(from, zone),
    endExclusive: analysisLocalDateStartUtc(endExclusiveKey, zone),
    previousStart: analysisLocalDateStartUtc(previousStartKey, zone),
    previousEndExclusive: analysisLocalDateStartUtc(previousEndExclusiveKey, zone),
    days,
    label: analysisPresetLabel(days),
    timeZone: zone
  };
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
