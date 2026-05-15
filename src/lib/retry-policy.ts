import { getFailureSeverity, getHumanReadableFailureMessage, type FailureCode } from "@/lib/failures";

export const MAX_RETRY_ATTEMPTS = 3;

const RETRYABLE_FAILURES = new Set<FailureCode>([
  "GMAIL_RATE_LIMITED",
  "GMAIL_TEMPORARY_FAILURE",
  "QUEUE_PROCESSING_FAILED",
  "DATABASE_UNAVAILABLE",
  "DATABASE_WRITE_FAILED",
  "REPLY_SYNC_FAILED",
  "OPEN_TRACKING_FAILED",
  "CLICK_TRACKING_FAILED"
]);

const RETRY_DELAYS_MINUTES: Partial<Record<FailureCode, number[]>> = {
  GMAIL_RATE_LIMITED: [15, 30, 60],
  GMAIL_TEMPORARY_FAILURE: [5, 15, 30],
  QUEUE_PROCESSING_FAILED: [5, 15, 30],
  DATABASE_UNAVAILABLE: [5, 15, 30],
  DATABASE_WRITE_FAILED: [5, 15, 30],
  REPLY_SYNC_FAILED: [5, 15, 30],
  OPEN_TRACKING_FAILED: [5, 15, 30],
  CLICK_TRACKING_FAILED: [5, 15, 30]
};

export function isRetryableFailure(code: FailureCode) {
  return RETRYABLE_FAILURES.has(code);
}

export function getNextRetryAt(code: FailureCode, retryCount: number, now = new Date()) {
  if (!isRetryableFailure(code) || retryCount >= MAX_RETRY_ATTEMPTS) {
    return null;
  }

  const delays = RETRY_DELAYS_MINUTES[code] ?? [5, 15, 30];
  const delayMinutes = delays[Math.min(retryCount, delays.length - 1)] ?? delays[delays.length - 1] ?? 5;
  return new Date(now.getTime() + delayMinutes * 60_000);
}

export function classifySendFailure(error: unknown, options: { senderConnected: boolean }): FailureCode {
  if (!options.senderConnected) {
    return "GMAIL_PROFILE_DISCONNECTED";
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("needs to be reconnected") ||
    normalized.includes("token has been expired") ||
    normalized.includes("token has been revoked")
  ) {
    return "GMAIL_TOKEN_EXPIRED";
  }

  if (
    normalized.includes("invalid_grant") ||
    normalized.includes("refresh token") ||
    normalized.includes("invalid credentials")
  ) {
    return "GMAIL_REFRESH_FAILED";
  }

  if (
    normalized.includes("daily user sending limit exceeded") ||
    normalized.includes("550-5.4.5") ||
    normalized.includes("550 5.4.5") ||
    normalized.includes("429") ||
    normalized.includes("rate limit")
  ) {
    return "GMAIL_RATE_LIMITED";
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("temporar") ||
    normalized.includes("unavailable") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up") ||
    /\b50[234]\b/.test(normalized)
  ) {
    return "GMAIL_TEMPORARY_FAILURE";
  }

  return "GMAIL_SEND_REJECTED";
}

export { getFailureSeverity, getHumanReadableFailureMessage };
