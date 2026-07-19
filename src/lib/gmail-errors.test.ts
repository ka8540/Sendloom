import { describe, expect, it } from "vitest";

import {
  buildGmailApiFailureDiagnostic,
  buildGmailSendFailureMetadata,
  getEnhancedStatusCodeFromText,
  isInvalidRecipientDiagnosticText,
  GmailSendError
} from "@/lib/gmail-errors";

describe("gmail error diagnostics", () => {
  it("extracts safe Gmail API error details for storage", () => {
    const diagnostic = buildGmailApiFailureDiagnostic(
      {
        code: 403,
        message: "User-rate limit exceeded",
        status: "PERMISSION_DENIED",
        errors: [{ reason: "userRateLimitExceeded", message: "User-rate limit exceeded" }]
      },
      {
        httpStatus: 403,
        retryAfter: "120",
        now: new Date("2026-05-27T12:00:00.000Z")
      }
    );
    const metadata = buildGmailSendFailureMetadata(new GmailSendError("User-rate limit exceeded", diagnostic), {
      failureCode: "GMAIL_RATE_LIMITED",
      retryable: true
    });

    expect(metadata).toMatchObject({
      provider: "gmail",
      failureCategory: "GMAIL_RATE_LIMITED",
      providerErrorCode: "403",
      providerErrorReason: "userRateLimitExceeded",
      providerErrorStatus: "PERMISSION_DENIED",
      providerHttpStatus: 403,
      providerErrorMessage: "User-rate limit exceeded",
      providerRetryAfterSeconds: 120,
      lastInternalError: {
        provider: "gmail",
        code: "403",
        reason: "userRateLimitExceeded",
        status: "PERMISSION_DENIED",
        retryable: true
      }
    });
  });

  it("redacts token-like values from stored diagnostic messages", () => {
    const metadata = buildGmailSendFailureMetadata(
      new Error("Authorization: Bearer ya29.super-secret-access-token-with-lots-of-characters"),
      {
        failureCode: "GMAIL_TEMPORARY_FAILURE",
        retryable: true
      }
    );

    expect(metadata.providerErrorMessage).toContain("[redacted]");
    expect(metadata.providerErrorMessage).not.toContain("super-secret-access-token");
  });
});

describe("invalid recipient detection", () => {
  it("recognizes recipient-address enhanced status codes by code alone", () => {
    for (const text of [
      "550 5.1.1 mailbox rejected",
      "550 5.1.2 bad domain",
      "5.1.3 bad destination syntax",
      "5.1.6 mailbox has moved",
      "5.1.10 RESOLVER.ADR.RecipientNotFound"
    ]) {
      expect(isInvalidRecipientDiagnosticText(text)).toBe(true);
    }
  });

  it("recognizes Gmail and common MTA invalid-address wordings", () => {
    for (const text of [
      "Address not found",
      "550 #5.1.0 Address rejected.",
      "The email account that you tried to reach does not exist",
      "the address couldn't be found, or is unable to receive mail",
      "user unknown",
      "No such user here",
      "550 5.4.1 Recipient address rejected: Access denied",
      "Mailbox unavailable",
      "Invalid to header"
    ]) {
      expect(isInvalidRecipientDiagnosticText(text)).toBe(true);
    }
  });

  it("never qualifies sender-address, ambiguous, or system errors", () => {
    for (const text of [
      "550 5.1.0 delivery failed",
      "550 5.1.7 bad sender address",
      "550 5.1.8 Sender address rejected: domain not allowed",
      "550 5.7.1 policy violation",
      "421 4.7.0 try again later",
      "Service unavailable",
      "The specified key does not exist.",
      "invalid_grant",
      "userRateLimitExceeded",
      ""
    ]) {
      expect(isInvalidRecipientDiagnosticText(text)).toBe(false);
    }
  });

  it("extracts the SMTP enhanced status code from diagnostic text", () => {
    expect(getEnhancedStatusCodeFromText("550 5.1.1 User unknown")).toBe("5.1.1");
    expect(getEnhancedStatusCodeFromText("550 #5.1.0 Address rejected.")).toBe("5.1.0");
    expect(getEnhancedStatusCodeFromText("plain rejection text")).toBeNull();
  });
});
