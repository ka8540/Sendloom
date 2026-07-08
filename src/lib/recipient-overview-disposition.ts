import { isPermanentRecipientAddressFailure, type FailureCode } from "@/lib/failures";
import { getFailureCodeFromMetadata } from "@/lib/retry-eligibility";

export type RecipientOverviewDisposition = "SENT" | "SKIPPED" | "NEEDS_ATTENTION" | "PENDING";

export type RecipientOverviewInput = {
  status: string;
  metadata?: unknown;
  lastError?: string | null;
};

export type RecipientOverviewDispositionCounts = {
  sent: number;
  skipped: number;
  needsAttention: number;
  pending: number;
};

type OverviewRunAggregateInput = {
  recipientJobs?: readonly RecipientOverviewInput[];
  totalRecipients: number;
  sentCount: number;
  openedCount?: number;
  clickedCount?: number;
  failedCount: number;
  suppressedCount: number;
  invalidCount: number;
};

const SENT_STATUSES = new Set(["SENT", "OPENED", "CLICKED"]);
const SKIPPED_STATUSES = new Set(["SUPPRESSED", "BOUNCED", "COMPLAINED"]);
const NEEDS_ATTENTION_STATUSES = new Set(["FAILED", "RETRYING"]);
const SKIPPED_FAILURE_CODES = new Set<FailureCode>([
  "INVALID_RECIPIENT_EMAIL",
  "DUPLICATE_RECIPIENT",
  "SUPPRESSED_RECIPIENT",
  "UNSUBSCRIBED_RECIPIENT",
  "HARD_BOUNCE_RECIPIENT"
]);

function getFailureCategory(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as { failureCategory?: unknown }).failureCategory;
  return typeof value === "string" ? value : null;
}

function hasClearLegacySkipReason(lastError: string | null | undefined) {
  const normalized = lastError?.trim().toLowerCase() ?? "";
  return [
    "address not found",
    "invalid address",
    "invalid recipient email",
    "unsubscribed",
    "suppression list",
    "suppressed recipient",
    "permanent delivery failure",
    "permanently rejected"
  ].some((reason) => normalized.includes(reason));
}

/**
 * The single recipient-level classification used by every Overview surface.
 * Address/compliance exclusions are calm Skipped outcomes; only technical or
 * retryable failures enter Needs attention.
 */
export function classifyRecipientOverviewDisposition(
  recipient: RecipientOverviewInput
): RecipientOverviewDisposition {
  const failureCode = getFailureCodeFromMetadata(recipient.metadata);
  const failureCategory = getFailureCategory(recipient.metadata);
  const isPermanentAddressFailure = isPermanentRecipientAddressFailure({ failureCode, failureCategory });

  if (SENT_STATUSES.has(recipient.status)) {
    // A successful send clears every failure field, so hard-bounce evidence on
    // a SENT/OPENED row can only mean the bounce was confirmed AFTER the send
    // (and a false "open" — e.g. Gmail's proxy fetching the pixel from the
    // quoted bounce — flipped the status back). The address never received the
    // message: that recipient is Skipped, not delivered. CLICKED is stronger
    // engagement evidence and stays a delivered outcome.
    if (isPermanentAddressFailure && recipient.status !== "CLICKED") {
      return "SKIPPED";
    }
    return "SENT";
  }

  if (
    SKIPPED_STATUSES.has(recipient.status) ||
    isPermanentAddressFailure ||
    (failureCode !== null && SKIPPED_FAILURE_CODES.has(failureCode)) ||
    hasClearLegacySkipReason(recipient.lastError)
  ) {
    return "SKIPPED";
  }

  // Current INVALID rows with configuration metadata (for example an
  // unresolved template variable) are operational problems. Legacy INVALID
  // rows without metadata represent unusable recipient addresses.
  if (recipient.status === "INVALID") {
    return failureCode ? "NEEDS_ATTENTION" : "SKIPPED";
  }

  if (NEEDS_ATTENTION_STATUSES.has(recipient.status)) {
    return "NEEDS_ATTENTION";
  }

  return "PENDING";
}

export function summarizeRecipientOverviewDispositions(
  recipients: readonly RecipientOverviewInput[]
): RecipientOverviewDispositionCounts {
  const counts: RecipientOverviewDispositionCounts = {
    sent: 0,
    skipped: 0,
    needsAttention: 0,
    pending: 0
  };

  for (const recipient of recipients) {
    switch (classifyRecipientOverviewDisposition(recipient)) {
      case "SENT":
        counts.sent += 1;
        break;
      case "SKIPPED":
        counts.skipped += 1;
        break;
      case "NEEDS_ATTENTION":
        counts.needsAttention += 1;
        break;
      case "PENDING":
        counts.pending += 1;
        break;
    }
  }

  return counts;
}

/**
 * Current runs pass recipientJobs and receive precise classifications. The
 * aggregate fallback is deliberately conservative for historical callers:
 * SUPPRESSED is explicitly skipped, while ambiguous INVALID/FAILED counts keep
 * their previous attention semantics instead of being blindly relabelled.
 */
export function summarizeOverviewRun(input: OverviewRunAggregateInput): RecipientOverviewDispositionCounts {
  if (input.recipientJobs && (input.recipientJobs.length > 0 || input.totalRecipients === 0)) {
    const detailed = summarizeRecipientOverviewDispositions(input.recipientJobs);
    const sent = Math.max(detailed.sent, input.sentCount + (input.openedCount ?? 0) + (input.clickedCount ?? 0));
    return {
      sent,
      skipped: detailed.skipped,
      needsAttention: detailed.needsAttention,
      pending: Math.max(0, input.totalRecipients - sent - detailed.skipped - detailed.needsAttention)
    };
  }

  const sent = input.sentCount + (input.openedCount ?? 0) + (input.clickedCount ?? 0);
  const skipped = input.suppressedCount;
  const needsAttention = input.failedCount + input.invalidCount;

  return {
    sent,
    skipped,
    needsAttention,
    pending: Math.max(0, input.totalRecipients - sent - skipped - needsAttention)
  };
}
