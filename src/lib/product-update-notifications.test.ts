import {
  ProductUpdateBroadcastRecipientStatus,
  ProductUpdateBroadcastStatus
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    PRODUCT_UPDATE_BATCH_SIZE: 25,
    PRODUCT_UPDATE_MAX_PER_RUN: 50,
    PRODUCT_UPDATE_PROCESSING_ENABLED: false
  }
}));

import {
  canDeliverProductUpdates,
  getProductUpdateAccountRecipientPage,
  processProductUpdateBroadcasts,
  type ClaimedProductUpdateRecipient,
  type ProductUpdateBroadcastRecord,
  type ProductUpdateStore
} from "@/lib/product-update-notifications";
import type { ProductUpdateMailer } from "@/lib/product-update-email";

type FakeUser = { id: string; email: string; prospectEmail?: string; connectedGmail?: string };
type FakeRecipient = {
  id: string;
  broadcastId: string;
  userId: string;
  emailSnapshot: string;
  status: ProductUpdateBroadcastRecipientStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
};

function makeBroadcast(overrides: Partial<ProductUpdateBroadcastRecord> = {}): ProductUpdateBroadcastRecord {
  return {
    id: "broadcast-1",
    status: ProductUpdateBroadcastStatus.SCHEDULED,
    subject: "New in Sendloom",
    headline: "Better workflows",
    intro: "We shipped an improvement.",
    features: [{ title: "Notifications", description: "Stay informed.", ctaLabel: null, ctaHref: null }],
    scheduledSendAt: new Date("2026-08-27T12:00:00Z"),
    timeZone: "America/Phoenix",
    recipientCursor: null,
    recipientsMaterializedAt: null,
    startedAt: null,
    ...overrides
  };
}

class FakeProductUpdateStore implements ProductUpdateStore {
  recipients: FakeRecipient[] = [];

  constructor(readonly broadcast: ProductUpdateBroadcastRecord, readonly users: FakeUser[]) {}

  async listProcessable(now: Date) {
    if (this.broadcast.status === ProductUpdateBroadcastStatus.SENDING) return [this.broadcast];
    if (
      this.broadcast.status === ProductUpdateBroadcastStatus.SCHEDULED &&
      this.broadcast.scheduledSendAt &&
      this.broadcast.scheduledSendAt <= now
    ) return [this.broadcast];
    return [];
  }

  async markSending(_broadcastId: string, now: Date) {
    if (
      this.broadcast.status !== ProductUpdateBroadcastStatus.SCHEDULED ||
      !this.broadcast.scheduledSendAt ||
      this.broadcast.scheduledSendAt > now
    ) return false;
    this.broadcast.status = ProductUpdateBroadcastStatus.SENDING;
    this.broadcast.startedAt = now;
    return true;
  }

  async materializeRecipientPage(_broadcastId: string, _take: number, now: Date) {
    if (this.broadcast.status !== ProductUpdateBroadcastStatus.SENDING || this.broadcast.recipientsMaterializedAt) {
      return { created: 0, complete: true };
    }
    let created = 0;
    for (const user of this.users) {
      if (this.recipients.some((recipient) => recipient.userId === user.id)) continue;
      this.recipients.push({
        id: `recipient-${user.id}`,
        broadcastId: this.broadcast.id,
        userId: user.id,
        emailSnapshot: user.email,
        status: ProductUpdateBroadcastRecipientStatus.PENDING,
        attempts: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null
      });
      created += 1;
    }
    this.broadcast.recipientsMaterializedAt = now;
    return { created, complete: true };
  }

  async claimRecipients(_broadcastId: string, limit: number, now: Date, leaseExpiresAt: Date) {
    return this.recipients
      .filter((recipient) =>
        recipient.attempts < 5 && (
          recipient.status === ProductUpdateBroadcastRecipientStatus.PENDING ||
          (recipient.status === ProductUpdateBroadcastRecipientStatus.RETRY && (!recipient.nextAttemptAt || recipient.nextAttemptAt <= now)) ||
          (recipient.status === ProductUpdateBroadcastRecipientStatus.SENDING && Boolean(recipient.leaseExpiresAt && recipient.leaseExpiresAt <= now))
        )
      )
      .slice(0, limit)
      .map((recipient) => {
        const previousStatus = recipient.status;
        const previousAttempts = recipient.attempts;
        recipient.status = ProductUpdateBroadcastRecipientStatus.SENDING;
        recipient.attempts += 1;
        recipient.leaseToken = `lease-${recipient.id}-${recipient.attempts}`;
        recipient.leaseExpiresAt = leaseExpiresAt;
        recipient.nextAttemptAt = null;
        return {
          id: recipient.id,
          broadcastId: recipient.broadcastId,
          userId: recipient.userId,
          emailSnapshot: recipient.emailSnapshot,
          attempts: recipient.attempts,
          leaseToken: recipient.leaseToken,
          previousStatus,
          previousAttempts
        };
      });
  }

  async releaseUnattemptedClaims(claims: ClaimedProductUpdateRecipient[], now: Date) {
    for (const claim of claims) {
      const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
      if (!recipient) continue;
      recipient.status = claim.previousStatus === ProductUpdateBroadcastRecipientStatus.SENDING
        ? ProductUpdateBroadcastRecipientStatus.RETRY
        : claim.previousStatus;
      recipient.attempts = claim.previousAttempts;
      recipient.nextAttemptAt = claim.previousStatus === ProductUpdateBroadcastRecipientStatus.SENDING ? now : null;
      recipient.leaseToken = null;
      recipient.leaseExpiresAt = null;
    }
  }

  async markRecipientSent(claim: ClaimedProductUpdateRecipient) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return false;
    recipient.status = ProductUpdateBroadcastRecipientStatus.SENT;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
    return true;
  }

  async markRecipientFailed(
    claim: ClaimedProductUpdateRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return;
    recipient.status = failure.permanent || recipient.attempts >= 5
      ? ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE
      : ProductUpdateBroadcastRecipientStatus.RETRY;
    recipient.nextAttemptAt = recipient.status === ProductUpdateBroadcastRecipientStatus.RETRY
      ? new Date(now.getTime() + 5 * 60 * 1000)
      : null;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
  }

  async markExhaustedRetriesPermanent() {
    let changed = 0;
    for (const recipient of this.recipients) {
      if (recipient.status === ProductUpdateBroadcastRecipientStatus.RETRY && recipient.attempts >= 5) {
        recipient.status = ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE;
        changed += 1;
      }
    }
    return changed;
  }

  async getProgress() {
    return {
      materialized: Boolean(this.broadcast.recipientsMaterializedAt),
      remaining: this.recipients.filter((recipient) =>
        new Set<ProductUpdateBroadcastRecipientStatus>([
          ProductUpdateBroadcastRecipientStatus.PENDING,
          ProductUpdateBroadcastRecipientStatus.SENDING,
          ProductUpdateBroadcastRecipientStatus.RETRY
        ]).has(recipient.status)
      ).length,
      permanentFailures: this.recipients.filter(
        (recipient) => recipient.status === ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE
      ).length
    };
  }

  async markCompleted() {
    if (this.broadcast.status !== ProductUpdateBroadcastStatus.SENDING) return false;
    this.broadcast.status = ProductUpdateBroadcastStatus.COMPLETED;
    return true;
  }
}

const runtime = { nodeEnv: "production", vercelEnv: "production", processingEnabled: true };
const noopAudit = vi.fn(async () => undefined);

function acceptingMailer(send = vi.fn()): ProductUpdateMailer & { send: ReturnType<typeof vi.fn> } {
  send.mockImplementation(async () => ({ status: "accepted", providerMessageId: `message-${send.mock.calls.length}` }));
  return { isConfigured: () => true, send };
}

describe("product update processor", () => {
  it("never sends early and never processes cancelled or completed broadcasts", async () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const store = new FakeProductUpdateStore(
      makeBroadcast({ scheduledSendAt: new Date("2026-08-27T12:00:01Z") }),
      [{ id: "u1", email: "one@example.com" }]
    );
    const mailer = acceptingMailer();
    expect(await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now }))
      .toMatchObject({ broadcastsDue: 0, recipientsSent: 0 });
    store.broadcast.status = ProductUpdateBroadcastStatus.CANCELLED;
    store.broadcast.scheduledSendAt = new Date("2026-08-27T11:00:00Z");
    await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now });
    store.broadcast.status = ProductUpdateBroadcastStatus.COMPLETED;
    await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now });
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("snapshots each User email once and never uses prospects or connected Gmail addresses", async () => {
    const store = new FakeProductUpdateStore(makeBroadcast(), [
      { id: "password", email: "password@example.com", prospectEmail: "lead@example.com" },
      { id: "google", email: "google@example.com", connectedGmail: "sender@gmail.com" },
      { id: "admin", email: "admin@example.com" }
    ]);
    const mailer = acceptingMailer();
    const now = new Date("2026-08-27T12:00:00Z");
    const first = await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now });
    const second = await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now });
    expect(first).toMatchObject({ broadcastsStarted: 1, broadcastsCompleted: 1, recipientsMaterialized: 3, recipientsSent: 3 });
    expect(second.recipientsSent).toBe(0);
    expect(store.recipients.map((recipient) => recipient.emailSnapshot).sort()).toEqual([
      "admin@example.com", "google@example.com", "password@example.com"
    ]);
    expect(mailer.send.mock.calls.map((call) => call[0].to)).not.toContain("sender@gmail.com");
    expect(mailer.send.mock.calls.map((call) => call[0].to)).not.toContain("lead@example.com");
  });

  it("uses atomic claims without duplicate sends across overlapping processors", async () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const store = new FakeProductUpdateStore(makeBroadcast(), [
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" }
    ]);
    const mailer = acceptingMailer();
    await Promise.all([
      processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now }),
      processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => now })
    ]);
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(new Set(mailer.send.mock.calls.map((call) => call[0].idempotencyKey)).size).toBe(2);
  });

  it("reuses the stable idempotency key across retry and preserves the email snapshot", async () => {
    let currentTime = new Date("2026-08-27T12:00:00Z");
    const user = { id: "u1", email: "snapshot@example.com" };
    const store = new FakeProductUpdateStore(makeBroadcast(), [user]);
    const send = vi.fn()
      .mockResolvedValueOnce({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true })
      .mockResolvedValueOnce({ status: "accepted", providerMessageId: "accepted" });
    const mailer: ProductUpdateMailer = { isConfigured: () => true, send };
    await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => currentTime });
    user.email = "changed@example.com";
    currentTime = new Date("2026-08-27T12:06:00Z");
    await processProductUpdateBroadcasts({ store, mailer, audit: noopAudit, runtime, now: () => currentTime });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey);
    expect(send.mock.calls[1][0].to).toBe("snapshot@example.com");
  });

  it("isolates a permanent bad address and completes delivery for other users", async () => {
    const store = new FakeProductUpdateStore(makeBroadcast(), [
      { id: "bad", email: "bad@example.com" },
      { id: "good", email: "good@example.com" }
    ]);
    const mailer: ProductUpdateMailer = {
      isConfigured: () => true,
      send: vi.fn(async ({ to }) => to === "bad@example.com"
        ? { status: "permanent" as const, errorCode: "validation_error" }
        : { status: "accepted" as const, providerMessageId: "good-message" })
    };
    const result = await processProductUpdateBroadcasts({
      store,
      mailer,
      audit: noopAudit,
      runtime,
      now: () => new Date("2026-08-27T12:00:00Z")
    });
    expect(result).toMatchObject({ recipientsSent: 1, failures: 1, broadcastsCompleted: 1 });
    expect(store.recipients.find((recipient) => recipient.userId === "bad")?.status)
      .toBe(ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE);
  });
});

describe("product update production gate and audience query", () => {
  it.each([
    ["development", "development", true],
    ["production", "preview", true],
    ["test", "production", true],
    ["production", "production", false]
  ])("blocks node=%s vercel=%s enabled=%s", (nodeEnv, vercelEnv, processingEnabled) => {
    expect(canDeliverProductUpdates({ nodeEnv, vercelEnv, processingEnabled })).toBe(false);
  });

  it("does not query, materialize, or send outside explicitly enabled Vercel Production", async () => {
    const store = new FakeProductUpdateStore(makeBroadcast(), [{ id: "u1", email: "one@example.com" }]);
    const listSpy = vi.spyOn(store, "listProcessable");
    const mailer = acceptingMailer();
    const result = await processProductUpdateBroadcasts({
      store,
      mailer,
      audit: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "preview", processingEnabled: true }
    });
    expect(result.deliveryEnabled).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("selects only User.id and User.email with no sender, prospect, or audience filter", async () => {
    const findMany = vi.fn(async (_args: unknown) => [{ id: "user-1", email: "account@example.com" }]);
    await getProductUpdateAccountRecipientPage(findMany, { cursor: "previous", take: 25 });
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: 25,
      cursor: { id: "previous" },
      skip: 1
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("where");
  });
});
