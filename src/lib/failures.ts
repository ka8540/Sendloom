export const FAILURE_CODES = [
  "GMAIL_TOKEN_EXPIRED",
  "GMAIL_REFRESH_FAILED",
  "GMAIL_RATE_LIMITED",
  "GMAIL_SEND_REJECTED",
  "GMAIL_TEMPORARY_FAILURE",
  "GMAIL_PROFILE_DISCONNECTED",
  "INVALID_RECIPIENT_EMAIL",
  "DUPLICATE_RECIPIENT",
  "SUPPRESSED_RECIPIENT",
  "UNSUBSCRIBED_RECIPIENT",
  "MISSING_TEMPLATE",
  "EMPTY_TEMPLATE_SUBJECT",
  "EMPTY_TEMPLATE_BODY",
  "MISSING_TEMPLATE_VARIABLE",
  "UNRESOLVED_TEMPLATE_VARIABLE",
  "MISSING_IMPORT",
  "EMPTY_IMPORT",
  "MISSING_MAPPING",
  "INVALID_SCHEDULE",
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_READ_FAILED",
  "REDIS_UNAVAILABLE",
  "QUEUE_PROCESSING_FAILED",
  "DATABASE_UNAVAILABLE",
  "DATABASE_WRITE_FAILED",
  "CRON_NOT_CONFIGURED",
  "CRON_AUTH_FAILED",
  "CAMPAIGN_STUCK",
  "REPLY_SYNC_FAILED",
  "OPEN_TRACKING_FAILED",
  "CLICK_TRACKING_FAILED",
  "APP_BASE_URL_MISSING",
  "SESSION_SECRET_MISSING",
  "GOOGLE_OAUTH_NOT_CONFIGURED",
  "MAIL_PROVIDER_NOT_CONFIGURED",
  "UNKNOWN_ERROR"
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];
export type FailureSeverity = "INFO" | "WARNING" | "ERROR" | "BLOCKER";
export type FailureSource =
  | "VALIDATION"
  | "GMAIL"
  | "IMPORT"
  | "TEMPLATE"
  | "SCHEDULE"
  | "ATTACHMENT"
  | "QUEUE"
  | "DATABASE"
  | "CRON"
  | "TRACKING"
  | "REPLY_SYNC"
  | "SUPPRESSION"
  | "SYSTEM";

export type FailureCheckResult = {
  code: FailureCode;
  severity: FailureSeverity;
  source: FailureSource;
  message: string;
  details?: string;
  retryable: boolean;
  actionLabel?: string;
  actionHref?: string;
};

const FAILURE_SEVERITY_BY_CODE: Record<FailureCode, FailureSeverity> = {
  GMAIL_TOKEN_EXPIRED: "BLOCKER",
  GMAIL_REFRESH_FAILED: "ERROR",
  GMAIL_RATE_LIMITED: "WARNING",
  GMAIL_SEND_REJECTED: "ERROR",
  GMAIL_TEMPORARY_FAILURE: "WARNING",
  GMAIL_PROFILE_DISCONNECTED: "BLOCKER",
  INVALID_RECIPIENT_EMAIL: "ERROR",
  DUPLICATE_RECIPIENT: "WARNING",
  SUPPRESSED_RECIPIENT: "WARNING",
  UNSUBSCRIBED_RECIPIENT: "WARNING",
  MISSING_TEMPLATE: "BLOCKER",
  EMPTY_TEMPLATE_SUBJECT: "BLOCKER",
  EMPTY_TEMPLATE_BODY: "BLOCKER",
  MISSING_TEMPLATE_VARIABLE: "BLOCKER",
  UNRESOLVED_TEMPLATE_VARIABLE: "BLOCKER",
  MISSING_IMPORT: "BLOCKER",
  EMPTY_IMPORT: "BLOCKER",
  MISSING_MAPPING: "BLOCKER",
  INVALID_SCHEDULE: "BLOCKER",
  ATTACHMENT_NOT_FOUND: "BLOCKER",
  ATTACHMENT_TOO_LARGE: "BLOCKER",
  ATTACHMENT_READ_FAILED: "BLOCKER",
  REDIS_UNAVAILABLE: "ERROR",
  QUEUE_PROCESSING_FAILED: "ERROR",
  DATABASE_UNAVAILABLE: "ERROR",
  DATABASE_WRITE_FAILED: "ERROR",
  CRON_NOT_CONFIGURED: "ERROR",
  CRON_AUTH_FAILED: "ERROR",
  CAMPAIGN_STUCK: "WARNING",
  REPLY_SYNC_FAILED: "WARNING",
  OPEN_TRACKING_FAILED: "WARNING",
  CLICK_TRACKING_FAILED: "WARNING",
  APP_BASE_URL_MISSING: "BLOCKER",
  SESSION_SECRET_MISSING: "BLOCKER",
  GOOGLE_OAUTH_NOT_CONFIGURED: "BLOCKER",
  MAIL_PROVIDER_NOT_CONFIGURED: "BLOCKER",
  UNKNOWN_ERROR: "ERROR"
};

const HUMAN_READABLE_FAILURE_MESSAGES: Record<FailureCode, string> = {
  GMAIL_TOKEN_EXPIRED: "The Gmail sender token has expired and needs attention.",
  GMAIL_REFRESH_FAILED: "Sendloom could not refresh the Gmail sender token.",
  GMAIL_RATE_LIMITED: "Gmail is rate limiting sends right now.",
  GMAIL_SEND_REJECTED: "Gmail rejected the send attempt.",
  GMAIL_TEMPORARY_FAILURE: "Gmail is temporarily unavailable for this send.",
  GMAIL_PROFILE_DISCONNECTED: "The Gmail sender needs to be reconnected.",
  INVALID_RECIPIENT_EMAIL: "One or more recipient email addresses are invalid.",
  DUPLICATE_RECIPIENT: "The import contains duplicate recipients.",
  SUPPRESSED_RECIPIENT: "One or more recipients are suppressed.",
  UNSUBSCRIBED_RECIPIENT: "One or more recipients have unsubscribed.",
  MISSING_TEMPLATE: "The campaign template is missing.",
  EMPTY_TEMPLATE_SUBJECT: "The template subject is empty.",
  EMPTY_TEMPLATE_BODY: "The template body is empty.",
  MISSING_TEMPLATE_VARIABLE: "A template variable is not mapped to import data.",
  UNRESOLVED_TEMPLATE_VARIABLE: "A template variable cannot be resolved for sending.",
  MISSING_IMPORT: "The campaign import is missing.",
  EMPTY_IMPORT: "The campaign import has no rows.",
  MISSING_MAPPING: "The campaign mapping is missing or incomplete.",
  INVALID_SCHEDULE: "The campaign schedule is invalid.",
  ATTACHMENT_NOT_FOUND: "An attachment is missing.",
  ATTACHMENT_TOO_LARGE: "An attachment exceeds the configured size limit.",
  ATTACHMENT_READ_FAILED: "An attachment could not be read.",
  REDIS_UNAVAILABLE: "Redis is unavailable.",
  QUEUE_PROCESSING_FAILED: "Queue processing failed.",
  DATABASE_UNAVAILABLE: "The database is unavailable.",
  DATABASE_WRITE_FAILED: "A database write failed.",
  CRON_NOT_CONFIGURED: "Cron is not configured.",
  CRON_AUTH_FAILED: "Cron authentication failed.",
  CAMPAIGN_STUCK: "The campaign appears to be stuck.",
  REPLY_SYNC_FAILED: "Reply sync failed.",
  OPEN_TRACKING_FAILED: "Open tracking failed.",
  CLICK_TRACKING_FAILED: "Click tracking failed.",
  APP_BASE_URL_MISSING: "APP_BASE_URL is not configured.",
  SESSION_SECRET_MISSING: "SESSION_SECRET is not configured.",
  GOOGLE_OAUTH_NOT_CONFIGURED: "Google OAuth is not configured for Gmail sending.",
  MAIL_PROVIDER_NOT_CONFIGURED: "The mail provider is not configured.",
  UNKNOWN_ERROR: "An unexpected error occurred."
};

export function getFailureSeverity(code: FailureCode) {
  return FAILURE_SEVERITY_BY_CODE[code];
}

export function getHumanReadableFailureMessage(code: FailureCode) {
  return HUMAN_READABLE_FAILURE_MESSAGES[code];
}

export function createFailureCheck(
  code: FailureCode,
  source: FailureSource,
  overrides: Partial<Omit<FailureCheckResult, "code" | "source">> = {}
): FailureCheckResult {
  return {
    code,
    source,
    severity: overrides.severity ?? getFailureSeverity(code),
    message: overrides.message ?? getHumanReadableFailureMessage(code),
    details: overrides.details,
    retryable: overrides.retryable ?? false,
    actionLabel: overrides.actionLabel,
    actionHref: overrides.actionHref
  };
}
