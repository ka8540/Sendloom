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
        gmailError({ httpStatus: 400, code: "400", status: "INVALID_ARGUMENT", message: "Malformed request payload" }),
        { senderConnected: true }
      )
    ).toBe("GMAIL_SEND_REJECTED");
  });

  it.each([
    "421 4.7.1 Recipient address rejected: try again later",
    "450 Recipient address rejected temporarily",
    "451 Recipient not found during a temporary directory failure",
    "452 Mailbox unavailable until storage recovers"
  ])("keeps temporary SMTP recipient wording retryable: %s", (message) => {
    const code = classifySendFailure(new Error(message), { senderConnected: true });
    expect(code).toBe("GMAIL_TEMPORARY_FAILURE");
    expect(isRetryableFailure(code)).toBe(true);
  });

  it.each([
    "550 5.1.0 Address rejected",
    "550 #5.1.0 Address rejected.",
    "550 5.1.1 The email account that you tried to reach does not exist",
    "550 5.1.1 Address not found",
    "550 5.1.1 User unknown",
    "Your message wasn't delivered because the address couldn't be found, or is unable to receive mail.",
    "553 No such user here",
    "550 Recipient address rejected: undeliverable address",
    "550 5.4.1 Recipient address rejected: Access denied",
    "550 5.2.1 Mailbox unavailable",
    "Invalid to header"
  ])("classifies %s as an invalid recipient address (skipped, suppressed, never retried)", (message) => {
    const code = classifySendFailure(new Error(message), { senderConnected: true });
    expect(code).toBe("HARD_BOUNCE_RECIPIENT");
    expect(isRetryableFailure(code)).toBe(false);
  });

  it("classifies a structured invalid-recipient diagnostic as an invalid address", () => {
    expect(
      classifySendFailure(
        gmailError({ httpStatus: 400, code: "400", status: "INVALID_ARGUMENT", message: "Invalid recipient" }),
        { senderConnected: true }
      )
    ).toBe("HARD_BOUNCE_RECIPIENT");
  });

  it("never classifies sender-account, transient, or attachment problems as invalid recipients", () => {
    const nonRecipient = [
      new Error("invalid_grant"),
      new Error("Token has been expired or revoked"),
      new Error("429 rate limit"),
      new Error("Backend Error"),
      new Error("Service unavailable"),
      new Error("The specified key does not exist."),
      new Error("Attachment resume.pdf is missing storage information."),
      new Error("550 5.1.8 Sender address rejected: domain not allowed"),
      gmailError({ httpStatus: 429, code: "429" })
    ];
    for (const error of nonRecipient) {
      expect(classifySendFailure(error, { senderConnected: true })).not.toBe("HARD_BOUNCE_RECIPIENT");
    }
  });
});
