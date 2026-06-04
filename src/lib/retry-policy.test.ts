import { describe, expect, it } from "vitest";

import {
  MAX_RETRY_ATTEMPTS,
  classifySendFailure,
  getNextRetryAt,
  isRetryableFailure
} from "@/lib/retry-policy";
import { GmailSendError, type GmailSendFailureDiagnostic } from "@/lib/gmail-errors";

function gmailError(diagnostic: Partial<GmailSendFailureDiagnostic>, message = "Gmail API rejected the send.") {
  return new GmailSendError(message, {
    provider: "gmail",
    timestamp: "2026-05-27T12:00:00.000Z",
    httpStatus: diagnostic.httpStatus ?? null,
    code: diagnostic.code ?? null,
    status: diagnostic.status ?? null,
    reason: diagnostic.reason ?? null,
    message: diagnostic.message ?? null,
    retryAfterSeconds: diagnostic.retryAfterSeconds ?? null
  });
}

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

  it("classifies structured Gmail quota and rate-limit diagnostics as retryable", () => {
    for (const error of [
      gmailError({ httpStatus: 429, code: "429", status: "RESOURCE_EXHAUSTED" }),
      gmailError({ httpStatus: 403, code: "403", reason: "userRateLimitExceeded" }),
      gmailError({ httpStatus: 403, code: "403", reason: "quotaExceeded" }),
      gmailError({ httpStatus: 403, code: "403", status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted" })
    ]) {
      const code = classifySendFailure(error, { senderConnected: true });
      expect(code).toBe("GMAIL_RATE_LIMITED");
      expect(isRetryableFailure(code)).toBe(true);
    }
  });

  it("classifies structured Gmail 5xx diagnostics as temporary", () => {
    expect(classifySendFailure(gmailError({ httpStatus: 503, code: "503" }), { senderConnected: true })).toBe(
      "GMAIL_TEMPORARY_FAILURE"
    );
    expect(
      classifySendFailure(gmailError({ httpStatus: 500, code: "500", reason: "backendError", message: "Backend Error" }), {
        senderConnected: true
      })
    ).toBe("GMAIL_TEMPORARY_FAILURE");
  });

  it.each([
    "Backend Error",
    "internalError",
    "Internal error, please try again later",
    "try again later",
    "500 Internal Server Error",
    "Service unavailable",
    "The service is temporarily unavailable",
    "socket hang up",
    "fetch failed"
  ])("classifies %s as a retryable temporary failure (not permanent)", (message) => {
    const code = classifySendFailure(new Error(message), { senderConnected: true });
    expect(code).toBe("GMAIL_TEMPORARY_FAILURE");
    expect(isRetryableFailure(code)).toBe(true);
  });

  it("never marks Gmail throttling or temporary errors as a permanent rejection", () => {
    const transient = [
      new Error("userRateLimitExceeded"),
      new Error("rateLimitExceeded"),
      new Error("Too many concurrent requests for user"),
      new Error("try again later"),
      new Error("Backend Error"),
      gmailError({ httpStatus: 429, code: "429" }),
      gmailError({ httpStatus: 403, code: "403", reason: "quotaExceeded" }),
      gmailError({ httpStatus: 503, code: "503" })
    ];
    for (const error of transient) {
      const code = classifySendFailure(error, { senderConnected: true });
      expect(code).not.toBe("GMAIL_SEND_REJECTED");
      expect(isRetryableFailure(code)).toBe(true);
    }
  });

  it("keeps unknown structured Gmail rejections permanent", () => {
    expect(
      classifySendFailure(
        gmailError({ httpStatus: 400, code: "400", status: "INVALID_ARGUMENT", message: "Invalid recipient" }),
        { senderConnected: true }
      )
    ).toBe("GMAIL_SEND_REJECTED");
  });

  it("keeps a 550 'no such user' recipient rejection permanent (not a 50x temporary)", () => {
    expect(
      classifySendFailure(new Error("550 5.1.1 The email account that you tried to reach does not exist"), {
        senderConnected: true
      })
    ).toBe("GMAIL_SEND_REJECTED");
  });
});
