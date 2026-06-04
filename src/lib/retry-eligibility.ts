import { FAILURE_CODES, type FailureCode } from "@/lib/failures";

/**
 * Run states that count as "finished" — the only states in which retrying the
 * failed recipients of a run makes sense. Mirrors the page's DONE_STATUSES.
 */
export const DONE_RUN_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * Failure codes that represent permanent, do-not-retry outcomes for a manual
 * "Retry failed recipients" action. Everything else that landed in FAILED —
 * Gmail rate/quota/temporary throttling, transient auth blips (once the sender
 * is reconnected), and generic or previously-misclassified send rejections — is
 * eligible for a user-initiated retry. Suppressed / invalid / unsubscribed
 * recipients never reach FAILED (they have their own statuses), but the matching
 * failure codes are listed here as a second line of defence.
 */
export const NON_RETRYABLE_FAILED_CODES: ReadonlySet<FailureCode> = new Set<FailureCode>([
  "INVALID_RECIPIENT_EMAIL",
  "DUPLICATE_RECIPIENT",
  "SUPPRESSED_RECIPIENT",
  "UNSUBSCRIBED_RECIPIENT",
  "MISSING_TEMPLATE_VARIABLE",
  "UNRESOLVED_TEMPLATE_VARIABLE",
  "EMPTY_TEMPLATE_SUBJECT",
  "EMPTY_TEMPLATE_BODY",
  "MISSING_TEMPLATE"
]);

export function getFailureCodeFromMetadata(metadata: unknown): FailureCode | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const code = (metadata as { failureCode?: unknown }).failureCode;
  return typeof code === "string" && (FAILURE_CODES as readonly string[]).includes(code)
    ? (code as FailureCode)
    : null;
}

/**
 * A recipient job is eligible for a manual retry when it is in the FAILED state
 * and its recorded failure code is not a permanent, do-not-retry outcome. Jobs
 * with no recorded failure code (generic failures) are eligible — the user is
 * explicitly choosing to retry them. Live suppression is re-checked separately
 * in the service before re-queueing.
 */
export function isManuallyRetriableFailedJob(job: { status: string; metadata: unknown }): boolean {
  if (job.status !== "FAILED") {
    return false;
  }

  const code = getFailureCodeFromMetadata(job.metadata);
  if (code && NON_RETRYABLE_FAILED_CODES.has(code)) {
    return false;
  }

  return true;
}

/**
 * Whether the "Retry failed recipients" action should be visible on the sequence
 * detail page. It only appears for a finished run that still has retryable failed
 * recipients, the sender connected, and nothing actively sending, paused, or
 * blocked by the Gmail daily safety limit.
 */
export function canShowRetryFailedAction(input: {
  latestRunStatus: string | null;
  isActiveRun: boolean;
  isPausedRun: boolean;
  senderConnected: boolean;
  dailyLimitActive: boolean;
  retryableFailedCount: number;
}): boolean {
  if (!input.latestRunStatus || !DONE_RUN_STATUSES.has(input.latestRunStatus)) {
    return false;
  }

  if (input.isActiveRun || input.isPausedRun) {
    return false;
  }

  if (!input.senderConnected || input.dailyLimitActive) {
    return false;
  }

  return input.retryableFailedCount > 0;
}
