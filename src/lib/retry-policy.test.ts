import { describe, expect, it } from "vitest";

import {
  MAX_RETRY_ATTEMPTS,
  classifySendFailure,
  getNextRetryAt,
  isRetryableFailure
} from "@/lib/retry-policy";

describe("retry policy", () => {
  it("retries temporary failures and caps retry scheduling at three attempts", () => {
    const now = new Date("2026-05-15T12:00:00.000Z");

    expect(isRetryableFailure("GMAIL_RATE_LIMITED")).toBe(true);
    expect(isRetryableFailure("INVALID_RECIPIENT_EMAIL")).toBe(false);
    expect(getNextRetryAt("GMAIL_RATE_LIMITED", 0, now)?.toISOString()).toBe("2026-05-15T12:15:00.000Z");
    expect(getNextRetryAt("GMAIL_RATE_LIMITED", MAX_RETRY_ATTEMPTS, now)).toBeNull();
  });

  it("classifies send failures for retry handling", () => {
    expect(classifySendFailure(new Error("429 rate limit"), { senderConnected: true })).toBe("GMAIL_RATE_LIMITED");
    expect(classifySendFailure(new Error("temporary upstream timeout"), { senderConnected: true })).toBe(
      "GMAIL_TEMPORARY_FAILURE"
    );
    expect(classifySendFailure(new Error("anything"), { senderConnected: false })).toBe("GMAIL_PROFILE_DISCONNECTED");
  });

  it.each([
    "User-rate limit exceeded",
    "userRateLimitExceeded",
    "rateLimitExceeded",
    "Daily Limit Exceeded",
    "dailyLimitExceeded",
    "Quota exceeded for user",
    "Too many concurrent requests for user",
    "Exceeded rate limits",
    "Mail sending limit exceeded for this account"
  ])("classifies %s as retryable rate-limit error (not permanent)", (message) => {
    const code = classifySendFailure(new Error(message), { senderConnected: true });
    expect(code).toBe("GMAIL_RATE_LIMITED");
    expect(isRetryableFailure(code)).toBe(true);
  });
});
