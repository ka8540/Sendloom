import { describe, expect, it } from "vitest";

import {
  classifyRecipientOverviewDisposition,
  summarizeOverviewRun
} from "@/lib/recipient-overview-disposition";

describe("recipient Overview disposition", () => {
  it.each([
    ["hard-bounced recipient", { status: "SUPPRESSED", metadata: { failureCode: "HARD_BOUNCE_RECIPIENT" } }],
    ["invalid-address recipient", { status: "INVALID", metadata: { failureCode: "INVALID_RECIPIENT_EMAIL" } }],
    ["unsubscribed recipient", { status: "SUPPRESSED", lastError: "Unsubscribed" }],
    ["manually suppressed recipient", { status: "SUPPRESSED", lastError: "On the suppression list" }]
  ])("maps a %s to Skipped", (_label, recipient) => {
    expect(classifyRecipientOverviewDisposition(recipient)).toBe("SKIPPED");
  });

  it.each([
    ["retryable provider error", { status: "RETRYING", metadata: { failureCode: "GMAIL_TEMPORARY_FAILURE" } }],
    ["Gmail authorization error", { status: "FAILED", metadata: { failureCode: "GMAIL_TOKEN_EXPIRED" } }],
    ["server error", { status: "FAILED", metadata: { failureCode: "QUEUE_PROCESSING_FAILED" } }]
  ])("maps a %s to Needs attention", (_label, recipient) => {
    expect(classifyRecipientOverviewDisposition(recipient)).toBe("NEEDS_ATTENTION");
  });

  it("maps successful recipients to Sent", () => {
    expect(classifyRecipientOverviewDisposition({ status: "SENT" })).toBe("SENT");
    expect(classifyRecipientOverviewDisposition({ status: "OPENED" })).toBe("SENT");
  });

  it("maps falsely-delivered SENT/OPENED rows with hard-bounce evidence to Skipped, protecting clicks", () => {
    // A hard-bounced message was never delivered — a lingering SENT status or
    // a false pixel "open" must not count the recipient as delivered.
    const metadata = { failureCode: "HARD_BOUNCE_RECIPIENT", failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND" };
    expect(classifyRecipientOverviewDisposition({ status: "SENT", metadata })).toBe("SKIPPED");
    expect(classifyRecipientOverviewDisposition({ status: "OPENED", metadata })).toBe("SKIPPED");
    expect(classifyRecipientOverviewDisposition({ status: "CLICKED", metadata })).toBe("SENT");
  });

  it("keeps ambiguous aggregate-only history conservative", () => {
    expect(
      summarizeOverviewRun({
        totalRecipients: 38,
        sentCount: 10,
        failedCount: 8,
        suppressedCount: 12,
        invalidCount: 8
      })
    ).toEqual({ sent: 10, skipped: 12, needsAttention: 16, pending: 0 });
  });
});
