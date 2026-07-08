import {
  FAILURE_CODES,
  getHumanReadableFailureMessage,
  isPermanentRecipientAddressFailure,
  type FailureCode
} from "@/lib/failures";

export const RECIPIENT_ACTIVITY_PAGE_SIZE = 10;

export type RecipientActivityTone = "success" | "warning" | "danger" | "neutral";

export type RecipientActivityItem = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  statusLabel: string;
  tone: RecipientActivityTone;
  engaged: boolean;
  message: string;
  isIssue: boolean;
  retryable: boolean;
  detailLabel: string | null;
  /** Optional fuller explanation for tooltips/screen readers — never repeated
   *  as permanently visible row copy. */
  hint: string | null;
  attemptCount: number;
  lastAttemptAt: string;
  nextRetryAt: string | null;
};

export type RecipientActivityPage = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  items: RecipientActivityItem[];
};

type RecipientJobInput = {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  status: string;
  lastError: string | null;
  metadata: unknown;
  retryCount: number;
  updatedAt: Date | string;
  nextRetryAt: Date | string | null;
};

const SUCCESS_STATUSES = new Set(["SENT", "OPENED", "CLICKED"]);
const ENGAGED_STATUSES = new Set(["OPENED", "CLICKED"]);
const ISSUE_STATUSES = new Set(["FAILED", "RETRYING", "INVALID", "BOUNCED", "COMPLAINED"]);
const ACTION_REQUIRED_FAILURES = new Set<FailureCode>([
  "GMAIL_PROFILE_DISCONNECTED",
  "GMAIL_TOKEN_EXPIRED",
  "GMAIL_REFRESH_FAILED"
]);

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  SENT: "Sent",
  OPENED: "Opened",
  CLICKED: "Clicked",
  RETRYING: "Retrying",
  FAILED: "Failed",
  INVALID: "Invalid",
  BOUNCED: "Bounced",
  COMPLAINED: "Complained",
  SUPPRESSED: "Skipped"
};

function toStatusLabel(status: string, failureCode: FailureCode | null) {
  if (failureCode && ACTION_REQUIRED_FAILURES.has(failureCode)) {
    return "Action required";
  }

  return STATUS_LABELS[status] ?? `${status.charAt(0)}${status.slice(1).toLowerCase()}`;
}

function toTone(status: string, failureCode: FailureCode | null): RecipientActivityTone {
  if (failureCode && ACTION_REQUIRED_FAILURES.has(failureCode)) {
    return "warning";
  }

  if (SUCCESS_STATUSES.has(status)) {
    return "success";
  }
  if (status === "RETRYING") {
    return "warning";
  }
  if (ISSUE_STATUSES.has(status)) {
    return "danger";
  }
  return "neutral";
}

function getFailureCode(metadata: unknown): FailureCode | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const code = (metadata as { failureCode?: unknown }).failureCode;
  return typeof code === "string" && FAILURE_CODES.includes(code as FailureCode) ? (code as FailureCode) : null;
}

function getFailureCategory(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const category = (metadata as { failureCategory?: unknown }).failureCategory;
  return typeof category === "string" ? category : null;
}

/** Concise visible reason for a permanently invalid address. */
function invalidAddressReason(failureCategory: string | null): string {
  if (failureCategory === "HARD_BOUNCE_DOMAIN_NOT_FOUND") {
    return "Domain not found";
  }
  if (failureCategory === "HARD_BOUNCE_PERMANENT_MAILBOX_FAILURE") {
    return "Mailbox unavailable";
  }
  if (failureCategory === "HARD_BOUNCE_INVALID_RECIPIENT") {
    return "Invalid address";
  }
  return "Address not found";
}

export const SKIPPED_INVALID_ADDRESS_HINT =
  "This email address was rejected as invalid and is skipped from future sends.";

// Compact the visible reason for skipped rows. Older records carry verbose
// sentences ("Address not found — this address previously returned a permanent
// delivery failure.", "Skipped — recipient unsubscribed.") — the row shows only
// the short reason; the fuller explanation lives in the hint.
function compactSkipReason(lastError: string | null): string {
  const normalized = lastError?.toLowerCase() ?? "";
  if (!normalized) {
    return "On the suppression list";
  }
  if (normalized.includes("unsubscribed")) {
    return "Unsubscribed";
  }
  if (normalized.includes("domain not found")) {
    return "Domain not found";
  }
  if (normalized.includes("mailbox unavailable")) {
    return "Mailbox unavailable";
  }
  if (normalized.includes("address not found")) {
    return "Address not found";
  }
  if (normalized.includes("invalid")) {
    return "Invalid address";
  }
  if (normalized.includes("permanent delivery failure") || normalized.includes("permanently rejected")) {
    return "Address not found";
  }
  if (normalized.includes("suppression list") || normalized.includes("suppressed")) {
    return "On the suppression list";
  }
  const trimmed = lastError?.trim() ?? "";
  // Strip trailing explanations after an em-dash so rows stay one line.
  return trimmed.split(" — ")[0] || "On the suppression list";
}

function inferFailureCode(lastError: string | null): FailureCode | null {
  const normalized = lastError?.toLowerCase() ?? "";
  if (normalized.includes("gmail sender needs to be reconnected") || normalized.includes("reconnect gmail")) {
    return "GMAIL_PROFILE_DISCONNECTED";
  }

  return null;
}

type SystemBlockReason = "DAILY_SEND_LIMIT" | "GMAIL_SENDER_LIMIT" | "GMAIL_SENDER_PACING";

function getSystemBlock(metadata: unknown): { blockedBy: SystemBlockReason; blockedUntil: string | null } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as { blockedBy?: unknown; blockedUntil?: unknown };
  if (
    record.blockedBy !== "DAILY_SEND_LIMIT" &&
    record.blockedBy !== "GMAIL_SENDER_LIMIT" &&
    record.blockedBy !== "GMAIL_SENDER_PACING"
  ) {
    return null;
  }
  return {
    blockedBy: record.blockedBy,
    blockedUntil: typeof record.blockedUntil === "string" ? record.blockedUntil : null
  };
}

function getSystemBlockMessage(blockedBy: SystemBlockReason) {
  switch (blockedBy) {
    case "DAILY_SEND_LIMIT":
      return "Daily Gmail safety limit reached. Sending resumes automatically when the safety window resets.";
    case "GMAIL_SENDER_PACING":
      // Compact per-row copy — the "Queued" pill carries the state, so this is a
      // short muted label rather than the full pacing explanation on every row.
      return "Next send window";
    default:
      return "Gmail is rate limiting sends right now. Sendloom will retry automatically.";
  }
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function resolveMessage(status: string, isIssue: boolean, failureCode: FailureCode | null, lastError: string | null) {
  const error = lastError?.trim() || null;

  switch (status) {
    case "SENT":
      return "Delivered successfully";
    case "OPENED":
      return "Opened after delivery";
    case "CLICKED":
      return "Clicked a tracked link";
    case "PENDING":
      return "Queued for delivery";
    case "SUPPRESSED":
      return error ?? "Skipped — recipient on the suppression list";
    default:
      break;
  }

  if (isIssue) {
    if (failureCode) {
      if (failureCode === "GMAIL_RATE_LIMITED") {
        return "Gmail is rate limiting sends right now. Sendloom will retry automatically.";
      }
      if (ACTION_REQUIRED_FAILURES.has(failureCode)) {
        return "Reconnect Gmail to continue sending.";
      }
      return getHumanReadableFailureMessage(failureCode);
    }
    if (error) {
      return error;
    }
    switch (status) {
      case "RETRYING":
        return "Temporary delivery issue — scheduled to retry.";
      case "INVALID":
        return "Invalid recipient email address.";
      case "BOUNCED":
        return "Message bounced after delivery.";
      case "COMPLAINED":
        return "Recipient reported the message as spam.";
      default:
        return "Delivery failed.";
    }
  }

  return "No activity reported yet";
}

/**
 * Build a serializable view model for a recipient job so the activity list
 * can be rendered identically by the server (initial page) and the client
 * (paginated fetches) without leaking Prisma types or raw metadata.
 */
export function buildRecipientActivityItem(job: RecipientJobInput): RecipientActivityItem {
  const isIssue = ISSUE_STATUSES.has(job.status);
  const failureCode = getFailureCode(job.metadata) ?? inferFailureCode(job.lastError);
  const failureCategory = getFailureCategory(job.metadata);
  const systemBlock = job.status === "PENDING" ? getSystemBlock(job.metadata) : null;

  // A confirmed permanently-invalid ADDRESS is not a Sendloom failure — the
  // send worked and the mailbox does not exist. Regardless of the stored
  // status (new rows are SUPPRESSED; rows written before this mapping may
  // still be FAILED/BOUNCED, and a false "open" recorded off a quoted bounce
  // can leave hard-bounce evidence on a SENT/OPENED row), the disposition
  // reads as a calm Invalid row with a concise reason. It never counts as an
  // issue, never reads as delivered, and can never be retried. CLICKED stays
  // an engagement outcome.
  if (
    isPermanentRecipientAddressFailure({ failureCode, failureCategory }) &&
    (job.status === "FAILED" ||
      job.status === "SUPPRESSED" ||
      job.status === "BOUNCED" ||
      job.status === "SENT" ||
      job.status === "OPENED")
  ) {
    return {
      id: job.id,
      email: job.recipientEmail,
      name: job.recipientName?.trim() ? job.recipientName.trim() : null,
      status: job.status,
      statusLabel: "Invalid",
      tone: "neutral",
      engaged: false,
      message: `Email address rejected — ${invalidAddressReason(failureCategory).toLowerCase()}`,
      isIssue: false,
      retryable: false,
      detailLabel: null,
      hint: SKIPPED_INVALID_ADDRESS_HINT,
      attemptCount: job.retryCount,
      lastAttemptAt: toIso(job.updatedAt),
      nextRetryAt: null
    };
  }

  if (systemBlock) {
    // Per-minute pacing is normal throttling, not something the user must act
    // on — surface it as "Queued" and keep it out of issue/attention counts.
    // The daily-cap and Gmail-throttle pauses stay flagged as warnings.
    const isPacing = systemBlock.blockedBy === "GMAIL_SENDER_PACING";
    return {
      id: job.id,
      email: job.recipientEmail,
      name: job.recipientName?.trim() ? job.recipientName.trim() : null,
      status: job.status,
      statusLabel: isPacing ? "Queued" : "Paused",
      tone: isPacing ? "neutral" : "warning",
      engaged: false,
      message: getSystemBlockMessage(systemBlock.blockedBy),
      isIssue: !isPacing,
      retryable: true,
      detailLabel: isPacing ? "Queued" : "Paused",
      hint: null,
      attemptCount: job.retryCount,
      lastAttemptAt: toIso(job.updatedAt),
      nextRetryAt: systemBlock.blockedUntil
    };
  }

  // Every excluded recipient reads "Skipped · <short reason>" — the fuller
  // explanation belongs to the hint, never permanently visible row copy.
  if (job.status === "SUPPRESSED") {
    return {
      id: job.id,
      email: job.recipientEmail,
      name: job.recipientName?.trim() ? job.recipientName.trim() : null,
      status: job.status,
      statusLabel: "Skipped",
      tone: "neutral",
      engaged: false,
      message: compactSkipReason(job.lastError),
      isIssue: false,
      retryable: false,
      detailLabel: null,
      hint: "This recipient is excluded from sending. Future sequences skip the address automatically.",
      attemptCount: job.retryCount,
      lastAttemptAt: toIso(job.updatedAt),
      nextRetryAt: null
    };
  }

  const retryable = job.status === "RETRYING";

  return {
    id: job.id,
    email: job.recipientEmail,
    name: job.recipientName?.trim() ? job.recipientName.trim() : null,
    status: job.status,
    statusLabel: toStatusLabel(job.status, failureCode),
    tone: toTone(job.status, failureCode),
    engaged: ENGAGED_STATUSES.has(job.status),
    message: resolveMessage(job.status, isIssue, failureCode, job.lastError),
    isIssue,
    retryable,
    detailLabel: failureCode && ACTION_REQUIRED_FAILURES.has(failureCode) ? "Action required" : retryable ? "Retrying" : null,
    hint: null,
    attemptCount: job.retryCount,
    lastAttemptAt: toIso(job.updatedAt),
    nextRetryAt: job.nextRetryAt ? toIso(job.nextRetryAt) : null
  };
}
