import { FAILURE_CODES, getHumanReadableFailureMessage, type FailureCode } from "@/lib/failures";

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
      return "Sending slowly to protect your Gmail account. Queued for the next send window.";
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
  const systemBlock = job.status === "PENDING" ? getSystemBlock(job.metadata) : null;

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
      attemptCount: job.retryCount,
      lastAttemptAt: toIso(job.updatedAt),
      nextRetryAt: systemBlock.blockedUntil
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
    attemptCount: job.retryCount,
    lastAttemptAt: toIso(job.updatedAt),
    nextRetryAt: job.nextRetryAt ? toIso(job.nextRetryAt) : null
  };
}
