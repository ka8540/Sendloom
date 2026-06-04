import { describe, expect, it } from "vitest";

import {
  canShowRetryFailedAction,
  isManuallyRetriableFailedJob
} from "@/lib/retry-eligibility";

function job(status: string, failureCode?: string | null) {
  return {
    status,
    metadata: failureCode === undefined ? null : { failureCode }
  };
}

describe("isManuallyRetriableFailedJob", () => {
  it("treats retryable Gmail throttling failures as eligible", () => {
    expect(isManuallyRetriableFailedJob(job("FAILED", "GMAIL_RATE_LIMITED"))).toBe(true);
    expect(isManuallyRetriableFailedJob(job("FAILED", "GMAIL_TEMPORARY_FAILURE"))).toBe(true);
  });

  it("treats generic / previously-misclassified send rejections as eligible", () => {
    expect(isManuallyRetriableFailedJob(job("FAILED", "GMAIL_SEND_REJECTED"))).toBe(true);
    expect(isManuallyRetriableFailedJob(job("FAILED", null))).toBe(true);
    expect(isManuallyRetriableFailedJob({ status: "FAILED", metadata: undefined })).toBe(true);
  });

  it("never retries permanent bad-data / suppression failures", () => {
    for (const code of [
      "INVALID_RECIPIENT_EMAIL",
      "DUPLICATE_RECIPIENT",
      "SUPPRESSED_RECIPIENT",
      "UNSUBSCRIBED_RECIPIENT",
      "MISSING_TEMPLATE_VARIABLE",
      "UNRESOLVED_TEMPLATE_VARIABLE"
    ]) {
      expect(isManuallyRetriableFailedJob(job("FAILED", code))).toBe(false);
    }
  });

  it("ignores non-failed statuses (sent, suppressed, invalid, queued, retrying)", () => {
    for (const status of ["SENT", "OPENED", "CLICKED", "SUPPRESSED", "INVALID", "PENDING", "RETRYING"]) {
      expect(isManuallyRetriableFailedJob(job(status, "GMAIL_RATE_LIMITED"))).toBe(false);
    }
  });
});

describe("canShowRetryFailedAction", () => {
  const base = {
    latestRunStatus: "COMPLETED",
    isActiveRun: false,
    isPausedRun: false,
    senderConnected: true,
    dailyLimitActive: false,
    retryableFailedCount: 94
  };

  it("shows for a completed run with retryable failed recipients", () => {
    expect(canShowRetryFailedAction(base)).toBe(true);
    expect(canShowRetryFailedAction({ ...base, latestRunStatus: "FAILED" })).toBe(true);
  });

  it("hides when there are zero retryable failed recipients", () => {
    expect(canShowRetryFailedAction({ ...base, retryableFailedCount: 0 })).toBe(false);
  });

  it("hides while a run is still queued/running or paused", () => {
    expect(canShowRetryFailedAction({ ...base, isActiveRun: true })).toBe(false);
    expect(canShowRetryFailedAction({ ...base, isPausedRun: true })).toBe(false);
    expect(canShowRetryFailedAction({ ...base, latestRunStatus: "RUNNING" })).toBe(false);
    expect(canShowRetryFailedAction({ ...base, latestRunStatus: "QUEUED" })).toBe(false);
  });

  it("hides when the sequence has never run", () => {
    expect(canShowRetryFailedAction({ ...base, latestRunStatus: null })).toBe(false);
  });

  it("hides when the sender is disconnected or the Gmail daily safety limit is active", () => {
    expect(canShowRetryFailedAction({ ...base, senderConnected: false })).toBe(false);
    expect(canShowRetryFailedAction({ ...base, dailyLimitActive: true })).toBe(false);
  });
});
