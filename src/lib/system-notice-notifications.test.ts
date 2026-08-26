import {
  SystemNoticeRecipientStatus,
  SystemNoticeStatus,
  SystemNoticeType
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    SYSTEM_NOTICE_BATCH_SIZE: 25,
    SYSTEM_NOTICE_MAX_PER_RUN: 50,
    SYSTEM_NOTICE_PROCESSING_ENABLED: false
  }
}));

import {
  canDeliverSystemNotices,
  getSystemNoticeAccountRecipientPage,
  processSystemNotices,
  type ClaimedSystemNoticeRecipient,
  type SystemNoticeRecord,
  type SystemNoticeStore
} from "@/lib/system-notice-notifications";
import type { SystemNoticeMailer } from "@/lib/system-notice-email";

type FakeUser = { id: string; email: string; connectedGmail?: string };
type FakeRecipient = {
  id: string;
  noticeId: string;
  userId: string;
  emailSnapshot: string;
  status: SystemNoticeRecipientStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
};

function makeNotice(overrides: Partial<SystemNoticeRecord> = {}): SystemNoticeRecord {
  return {
    id: "notice-1",
    type: SystemNoticeType.GENERAL,
    status: SystemNoticeStatus.SCHEDULED,
    subject: "Sendloom service notice",
    title: "Service update",
    message: "An operational update.",
    affectedArea: null,
    scheduledSendAt: new Date("2026-08-24T12:00:00Z"),
    impactStartsAt: null,
    impactEndsAt: null,
    timeZone: "America/Phoenix",
    recipientCursor: null,
    recipientsMaterializedAt: null,
    startedAt: null,
    ...overrides
  };
}

class FakeSystemNoticeStore implements SystemNoticeStore {
  recipients: FakeRecipient[] = [];

  constructor(readonly notice: SystemNoticeRecord, readonly users: FakeUser[]) {}

  async listProcessable(now: Date) {
    if (this.notice.status === SystemNoticeStatus.SENDING) return [this.notice];
    if (
      this.notice.status === SystemNoticeStatus.SCHEDULED &&
      this.notice.scheduledSendAt &&
      this.notice.scheduledSendAt <= now
    ) {
      return [this.notice];
    }
    return [];
  }

  async markSending(_noticeId: string, now: Date) {
    if (
      this.notice.status !== SystemNoticeStatus.SCHEDULED ||
      !this.notice.scheduledSendAt ||
      this.notice.scheduledSendAt > now
    ) {
      return false;
    }
    this.notice.status = SystemNoticeStatus.SENDING;
    this.notice.startedAt = now;
    return true;
  }

  async materializeRecipientPage(_noticeId: string, _take: number, now: Date) {
    if (this.notice.status !== SystemNoticeStatus.SENDING || this.notice.recipientsMaterializedAt) {
      return { created: 0, complete: true };
    }
    let created = 0;
    for (const user of this.users) {
      if (this.recipients.some((recipient) => recipient.userId === user.id)) continue;
      this.recipients.push({
        id: `recipient-${user.id}`,
        noticeId: this.notice.id,
        userId: user.id,
        emailSnapshot: user.email,
        status: SystemNoticeRecipientStatus.PENDING,
        attempts: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null
      });
      created += 1;
    }
    this.notice.recipientsMaterializedAt = now;
    return { created, complete: true };
  }

  async claimRecipients(_noticeId: string, limit: number, now: Date, leaseExpiresAt: Date) {
    return this.recipients
      .filter(
        (recipient) =>
          recipient.attempts < 5 &&
          (recipient.status === SystemNoticeRecipientStatus.PENDING ||
            (recipient.status === SystemNoticeRecipientStatus.RETRY &&
              (!recipient.nextAttemptAt || recipient.nextAttemptAt <= now)) ||
            (recipient.status === SystemNoticeRecipientStatus.SENDING &&
              Boolean(recipient.leaseExpiresAt && recipient.leaseExpiresAt <= now)))
      )
      .slice(0, limit)
      .map((recipient) => {
        const previousStatus = recipient.status;
        const previousAttempts = recipient.attempts;
        recipient.status = SystemNoticeRecipientStatus.SENDING;
        recipient.attempts += 1;
        recipient.leaseToken = `lease-${recipient.id}-${recipient.attempts}`;
        recipient.leaseExpiresAt = leaseExpiresAt;
        recipient.nextAttemptAt = null;
        return {
          id: recipient.id,
          noticeId: recipient.noticeId,
          userId: recipient.userId,
          emailSnapshot: recipient.emailSnapshot,
          attempts: recipient.attempts,
          leaseToken: recipient.leaseToken,
          previousStatus,
          previousAttempts
        };
      });
  }

  async releaseUnattemptedClaims(claims: ClaimedSystemNoticeRecipient[], now: Date) {
    for (const claim of claims) {
      const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
      if (!recipient) continue;
      recipient.status =
        claim.previousStatus === SystemNoticeRecipientStatus.SENDING
          ? SystemNoticeRecipientStatus.RETRY
          : claim.previousStatus;
      recipient.attempts = claim.previousAttempts;
      recipient.nextAttemptAt = claim.previousStatus === SystemNoticeRecipientStatus.SENDING ? now : null;
      recipient.leaseToken = null;
      recipient.leaseExpiresAt = null;
    }
  }

  async markRecipientSent(claim: ClaimedSystemNoticeRecipient) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return false;
    recipient.status = SystemNoticeRecipientStatus.SENT;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
    return true;
  }

  async markRecipientFailed(
    claim: ClaimedSystemNoticeRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return;
    recipient.status =
      failure.permanent || recipient.attempts >= 5
        ? SystemNoticeRecipientStatus.PERMANENT_FAILURE
        : SystemNoticeRecipientStatus.RETRY;
    recipient.nextAttemptAt =
      recipient.status === SystemNoticeRecipientStatus.RETRY
        ? new Date(now.getTime() + 5 * 60 * 1000)
        : null;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
  }

  async markExhaustedRetriesPermanent() {
    let changed = 0;
    for (const recipient of this.recipients) {
      if (recipient.status === SystemNoticeRecipientStatus.RETRY && recipient.attempts >= 5) {
        recipient.status = SystemNoticeRecipientStatus.PERMANENT_FAILURE;
        changed += 1;
      }
    }
    return changed;
  }

  async getProgress() {
    return {
      materialized: Boolean(this.notice.recipientsMaterializedAt),
      remaining: this.recipients.filter((recipient) =>
        new Set<SystemNoticeRecipientStatus>([
          SystemNoticeRecipientStatus.PENDING,
          SystemNoticeRecipientStatus.SENDING,
          SystemNoticeRecipientStatus.RETRY
        ]).has(recipient.status)
      ).length,
      permanentFailures: this.recipients.filter(
        (recipient) => recipient.status === SystemNoticeRecipientStatus.PERMANENT_FAILURE
      ).length
    };
  }

  async markCompleted() {
    if (this.notice.status !== SystemNoticeStatus.SENDING) return false;
    this.notice.status = SystemNoticeStatus.COMPLETED;
    return true;
  }
}

const runtime = { nodeEnv: "production", vercelEnv: "production", processingEnabled: true };
const noopAudit = vi.fn(async () => undefined);

function acceptingMailer(send = vi.fn()): SystemNoticeMailer & { send: ReturnType<typeof vi.fn> } {
  send.mockImplementation(async () => ({ status: "accepted", providerMessageId: `message-${send.mock.calls.length}` }));
  return { isConfigured: () => true, send };
}

describe("system notice processor", () => {
  it("never sends early and ignores cancelled notices", async () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const future = new FakeSystemNoticeStore(
      makeNotice({ scheduledSendAt: new Date("2026-08-24T12:00:01Z") }),
      [{ id: "u1", email: "one@example.com" }]
    );
    const mailer = acceptingMailer();
    const result = await processSystemNotices({ store: future, mailer, audit: noopAudit, runtime, now: () => now });
    expect(result).toMatchObject({ noticesDue: 0, recipientsSent: 0 });
    expect(future.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();

    future.notice.status = SystemNoticeStatus.CANCELLED;
    future.notice.scheduledSendAt = new Date("2026-08-24T11:00:00Z");
    await processSystemNotices({ store: future, mailer, audit: noopAudit, runtime, now: () => now });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("materializes every User email once and never uses a connected Gmail sender", async () => {
    const store = new FakeSystemNoticeStore(makeNotice(), [
      { id: "password", email: "password@example.com" },
      { id: "google", email: "google@example.com", connectedGmail: "sender@gmail.com" },
      { id: "admin", email: "admin@example.com" }
    ]);
    const mailer = acceptingMailer();
    const now = new Date("2026-08-24T12:00:00Z");
    const first = await processSystemNotices({ store, mailer, audit: noopAudit, runtime, now: () => now });
    const second = await processSystemNotices({ store, mailer, audit: noopAudit, runtime, now: () => now });

    expect(first).toMatchObject({ noticesStarted: 1, noticesCompleted: 1, recipientsMaterialized: 3, recipientsSent: 3 });
    expect(second.recipientsSent).toBe(0);
    expect(store.recipients.map((recipient) => recipient.emailSnapshot).sort()).toEqual([
      "admin@example.com",
      "google@example.com",
      "password@example.com"
    ]);
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(mailer.send.mock.calls.map((call) => call[0].to)).not.toContain("sender@gmail.com");
    expect(new Set(mailer.send.mock.calls.map((call) => call[0].idempotencyKey)).size).toBe(3);
  });

  it("uses atomic claims plus stable keys across overlapping processors and retries", async () => {
    let currentTime = new Date("2026-08-24T12:00:00Z");
    const store = new FakeSystemNoticeStore(makeNotice(), [
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" }
    ]);
    const send = vi.fn(async (_input: Parameters<SystemNoticeMailer["send"]>[0]) => ({
      status: "accepted" as const,
      providerMessageId: "accepted"
    }));
    const mailer: SystemNoticeMailer = { isConfigured: () => true, send };

    await Promise.all([
      processSystemNotices({ store, mailer, audit: noopAudit, runtime, now: () => currentTime }),
      processSystemNotices({ store, mailer, audit: noopAudit, runtime, now: () => currentTime })
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map((call) => call[0].idempotencyKey)).size).toBe(2);

    const retryStore = new FakeSystemNoticeStore(makeNotice({ id: "retry-notice" }), [
      { id: "u3", email: "retry@example.com" }
    ]);
    const retrySend = vi
      .fn()
      .mockResolvedValueOnce({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true })
      .mockResolvedValueOnce({ status: "accepted", providerMessageId: "retry-accepted" });
    const retryMailer: SystemNoticeMailer = { isConfigured: () => true, send: retrySend };
    await processSystemNotices({ store: retryStore, mailer: retryMailer, audit: noopAudit, runtime, now: () => currentTime });
    currentTime = new Date("2026-08-24T12:06:00Z");
    await processSystemNotices({ store: retryStore, mailer: retryMailer, audit: noopAudit, runtime, now: () => currentTime });
    expect(retrySend).toHaveBeenCalledTimes(2);
    expect(retrySend.mock.calls[0][0].idempotencyKey).toBe(retrySend.mock.calls[1][0].idempotencyKey);
  });

  it("isolates a permanent bad address and completes delivery for other users", async () => {
    const store = new FakeSystemNoticeStore(makeNotice(), [
      { id: "bad", email: "bad@example.com" },
      { id: "good", email: "good@example.com" }
    ]);
    const mailer: SystemNoticeMailer = {
      isConfigured: () => true,
      send: vi.fn(async ({ to }) =>
        to === "bad@example.com"
          ? { status: "permanent" as const, errorCode: "validation_error" }
          : { status: "accepted" as const, providerMessageId: "good-message" }
      )
    };
    const result = await processSystemNotices({
      store,
      mailer,
      audit: noopAudit,
      runtime,
      now: () => new Date("2026-08-24T12:00:00Z")
    });
    expect(result).toMatchObject({ recipientsSent: 1, failures: 1, noticesCompleted: 1 });
    expect(store.recipients.find((recipient) => recipient.userId === "bad")?.status).toBe(
      SystemNoticeRecipientStatus.PERMANENT_FAILURE
    );
  });
});

describe("system notice production gate and account query", () => {
  it.each([
    ["development", "development", true],
    ["production", "preview", true],
    ["test", "production", true],
    ["production", "production", false]
  ])("blocks node=%s vercel=%s enabled=%s", (nodeEnv, vercelEnv, processingEnabled) => {
    expect(canDeliverSystemNotices({ nodeEnv, vercelEnv, processingEnabled })).toBe(false);
  });

  it("does not query or mutate delivery state outside explicitly enabled Vercel Production", async () => {
    const store = new FakeSystemNoticeStore(makeNotice(), [{ id: "u1", email: "one@example.com" }]);
    const listSpy = vi.spyOn(store, "listProcessable");
    const mailer = acceptingMailer();
    const result = await processSystemNotices({
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

  it("selects only User.id and User.email with no account or sender filter", async () => {
    const findMany = vi.fn(async (_args: unknown) => [{ id: "user-1", email: "account@example.com" }]);
    await getSystemNoticeAccountRecipientPage(findMany, { cursor: "previous", take: 25 });
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
