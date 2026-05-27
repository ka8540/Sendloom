import { describe, expect, it } from "vitest";

import {
  buildGmailApiFailureDiagnostic,
  buildGmailSendFailureMetadata,
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
