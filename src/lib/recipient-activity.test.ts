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
});
