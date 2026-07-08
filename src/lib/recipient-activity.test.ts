import { describe, expect, it } from "vitest";

import { buildRecipientActivityItem } from "@/lib/recipient-activity";

const BASE_JOB = {
  id: "job_1",
  recipientEmail: "recipient@example.com",
  recipientName: null,
  lastError: null,
  retryCount: 0,
  updatedAt: new Date("2026-05-27T12:00:00.000Z"),
  nextRetryAt: null
};

describe("recipient activity", () => {
  it("shows Gmail rate limits as retrying instead of permanent", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "RETRYING",
      retryCount: 1,
      nextRetryAt: new Date("2026-05-27T12:15:00.000Z"),
      lastError: "Couldn't send the email right now. Please try again.",
      metadata: {
        failureCode: "GMAIL_RATE_LIMITED",
        retryable: true
      }
    });

    expect(item.statusLabel).toBe("Retrying");
    expect(item.message).toBe("Gmail is rate limiting sends right now. Sendloom will retry automatically.");
    expect(item.retryable).toBe(true);
    expect(item.detailLabel).toBe("Retrying");
    expect(item.nextRetryAt).toBe("2026-05-27T12:15:00.000Z");
  });

  it("shows system-held Gmail sender limits as paused", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "PENDING",
      metadata: {
        failureCode: "GMAIL_RATE_LIMITED",
        blockedBy: "GMAIL_SENDER_LIMIT",
        blockedUntil: "2026-05-27T13:00:00.000Z"
      }
    });

    expect(item.statusLabel).toBe("Paused");
    expect(item.message).toBe("Gmail is rate limiting sends right now. Sendloom will retry automatically.");
    expect(item.detailLabel).toBe("Paused");
    expect(item.nextRetryAt).toBe("2026-05-27T13:00:00.000Z");
  });

  it("shows per-minute pacing as queued, never failed or permanent", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "PENDING",
      retryCount: 0,
      metadata: {
        blockedBy: "GMAIL_SENDER_PACING",
        blockedUntil: "2026-05-27T12:01:00.000Z",
        retryable: true
      }
    });

    expect(item.statusLabel).toBe("Queued");
    // Compact copy — no long repeated pacing sentence on every queued row.
    expect(item.message).toBe("Next send window");
    // Pacing is normal throttling — not an issue, not failed, not permanent.
    expect(item.isIssue).toBe(false);
    expect(item.retryable).toBe(true);
    expect(item.tone).toBe("neutral");
    expect(item.detailLabel).not.toBe("Permanent");
    expect(item.nextRetryAt).toBe("2026-05-27T12:01:00.000Z");
  });

  it("shows Gmail auth failures as action required", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "FAILED",
      lastError: "This Gmail sender needs to be reconnected.",
      metadata: null
    });

    expect(item.statusLabel).toBe("Action required");
    expect(item.message).toBe("Reconnect Gmail to continue sending.");
    expect(item.detailLabel).toBe("Action required");
    expect(item.retryable).toBe(false);
  });


  // -------------------------------------------------------------------------
  // Permanent invalid addresses read as Invalid — never a Sendloom failure.
  // -------------------------------------------------------------------------

  it("shows a confirmed hard bounce as Invalid · Email address rejected (never Failed)", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "SUPPRESSED",
      lastError: "Address not found",
      metadata: {
        failureCode: "HARD_BOUNCE_RECIPIENT",
        failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND"
      }
    });

    expect(item.statusLabel).toBe("Invalid");
    expect(item.message).toBe("Email address rejected.");
    expect(item.statusLabel).not.toBe("Failed");
    // Calm styling: not an issue, so the red detail strip ("PERMANENT",
    // attempt metadata) never renders, and there is no Retry.
    expect(item.isIssue).toBe(false);
    expect(item.retryable).toBe(false);
    expect(item.tone).toBe("neutral");
    expect(item.detailLabel).toBeNull();
    // The skipped-from-future-sends explanation lives in the accessible hint.
    expect(item.hint).toBe("Skipped from future sends.");
    expect(item.message).not.toContain("permanent delivery failure");
  });

  it("normalizes legacy hard-bounce rows still stored as FAILED to the same Invalid disposition", () => {
    const item = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "FAILED",
      lastError: "The address returned a permanent delivery failure and is excluded from future sends.",
      metadata: {
        failureCode: "HARD_BOUNCE_RECIPIENT",
        failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT"
      }
    });

    expect(item.statusLabel).toBe("Invalid");
    expect(item.message).toBe("Email address rejected.");
    expect(item.isIssue).toBe(false);
    expect(item.retryable).toBe(false);
  });

  it("shows falsely-delivered SENT/OPENED rows carrying hard-bounce evidence as Invalid, never Opened", () => {
    for (const status of ["SENT", "OPENED"]) {
      const item = buildRecipientActivityItem({
        ...BASE_JOB,
        status,
        metadata: {
          failureCode: "HARD_BOUNCE_RECIPIENT",
          failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND"
        }
      });
      expect(item.statusLabel).toBe("Invalid");
      expect(item.message).toBe("Email address rejected.");
      expect(item.engaged).toBe(false);
      expect(item.isIssue).toBe(false);
      expect(item.retryable).toBe(false);
    }

    // A real click is strong engagement evidence and keeps its outcome.
    const clicked = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "CLICKED",
      metadata: { failureCode: "HARD_BOUNCE_RECIPIENT" }
    });
    expect(clicked.statusLabel).toBe("Clicked");
  });

  it("keeps real system and Gmail failures as Failed / action required", () => {
    const gmailAuth = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "FAILED",
      lastError: "This Gmail sender needs to be reconnected.",
      metadata: { failureCode: "GMAIL_PROFILE_DISCONNECTED" }
    });
    expect(gmailAuth.statusLabel).toBe("Action required");
    expect(gmailAuth.isIssue).toBe(true);

    const serverError = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "FAILED",
      lastError: "Queue processing failed.",
      metadata: { failureCode: "QUEUE_PROCESSING_FAILED" }
    });
    expect(serverError.statusLabel).toBe("Failed");
    expect(serverError.isIssue).toBe(true);
  });

  it("compacts every skipped row to a short reason with the explanation in the hint", () => {
    const unsubscribed = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "SUPPRESSED",
      lastError: "Skipped — recipient unsubscribed.",
      metadata: {}
    });
    expect(unsubscribed.statusLabel).toBe("Skipped");
    expect(unsubscribed.message).toBe("Unsubscribed");
    expect(unsubscribed.isIssue).toBe(false);

    const legacyVerbose = buildRecipientActivityItem({
      ...BASE_JOB,
      status: "SUPPRESSED",
      lastError: "Address not found — this address previously returned a permanent delivery failure.",
      metadata: {}
    });
    expect(legacyVerbose.message).toBe("Address not found");
    expect(legacyVerbose.hint).toBeTruthy();
  });
});
