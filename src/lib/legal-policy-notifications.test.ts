import {
  LegalPolicyNoticeRecipientStatus,
  LegalPolicyNoticeStatus
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { computeLegalPolicyContentHash } from "@/lib/legal-policy-fingerprint";
import {
  canDeliverLegalPolicyNotices,
  evaluatePolicyRelease,
  getAccountRecipientPage,
  processLegalPolicyNotices,
  type ClaimedLegalNoticeRecipient,
  type LegalNoticeRecord,
  type LegalNoticeStore
} from "@/lib/legal-policy-notifications";
import { LEGAL_POLICIES, LEGAL_POLICY_LIST, type LegalPolicy } from "@/lib/legal-policies";
import type { LegalNoticeMailer } from "@/lib/legal-notice-email";

type FakeUser = {
  id: string;
  email: string;
  passwordHash?: string | null;
  googleSub?: string | null;
};

type FakeRecipient = {
  id: string;
  noticeId: string;
  userId: string;
  emailSnapshot: string;
  status: LegalPolicyNoticeRecipientStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  providerMessageId: string | null;
};

class FakeLegalNoticeStore implements LegalNoticeStore {
  histories = new Map<string, Awaited<ReturnType<LegalNoticeStore["listPolicyHistory"]>>>();
  notices: LegalNoticeRecord[] = [];
  recipients: FakeRecipient[] = [];
  users: FakeUser[];
  private sequence = 0;

  constructor(users: FakeUser[] = []) {
    this.users = users;
  }

  listPolicyHistory(policy: LegalPolicy["id"]) {
    return Promise.resolve([...(this.histories.get(policy) ?? [])]);
  }

  async createBaseline(policy: LegalPolicy, contentHash: string) {
    if ((this.histories.get(policy.id) ?? []).some((item) => item.version === policy.version)) return false;
    const createdAt = new Date(`2026-08-23T00:00:0${this.sequence}Z`);
    const release = {
      id: `baseline-${policy.id}`,
      version: policy.version,
      contentHash,
      status: LegalPolicyNoticeStatus.BASELINE,
      createdAt
    };
    this.histories.set(policy.id, [release, ...(this.histories.get(policy.id) ?? [])]);
    return true;
  }

  async createNotice(policy: LegalPolicy, contentHash: string) {
    if ((this.histories.get(policy.id) ?? []).some((item) => item.version === policy.version)) return false;
    this.sequence += 1;
    const id = `notice-${this.sequence}`;
    const createdAt = new Date(`2026-09-01T00:00:0${this.sequence}Z`);
    this.histories.set(policy.id, [
      { id, version: policy.version, contentHash, status: LegalPolicyNoticeStatus.PENDING, createdAt },
      ...(this.histories.get(policy.id) ?? [])
    ]);
    this.notices.push({
      id,
      policy: policy.id,
      version: policy.version,
      policyTitle: policy.title,
      policyPath: policy.path,
      contentHash,
      lastUpdated: policy.lastUpdated,
      changeSummary: [...policy.changeSummary],
      status: LegalPolicyNoticeStatus.PENDING,
      recipientCursor: null,
      recipientsMaterializedAt: null
    });
    return true;
  }

  listActiveNotices() {
    return Promise.resolve(
      this.notices.filter(
        (notice) =>
          notice.status === LegalPolicyNoticeStatus.PENDING || notice.status === LegalPolicyNoticeStatus.PROCESSING
      )
    );
  }

  async markNoticeProcessing(noticeId: string) {
    const notice = this.notices.find((item) => item.id === noticeId);
    if (!notice || notice.status !== LegalPolicyNoticeStatus.PENDING) return false;
    notice.status = LegalPolicyNoticeStatus.PROCESSING;
    return true;
  }

  async materializeRecipientPage(noticeId: string, take: number, now: Date) {
    const notice = this.notices.find((item) => item.id === noticeId);
    if (!notice || notice.recipientsMaterializedAt) return { created: 0, complete: true };
    const start = notice.recipientCursor
      ? Math.max(
          this.users.findIndex((user) => user.id === notice.recipientCursor) + 1,
          0
        )
      : 0;
    const page = this.users.slice(start, start + take);
    let created = 0;
    for (const user of page) {
      if (this.recipients.some((recipient) => recipient.noticeId === noticeId && recipient.userId === user.id)) continue;
      this.recipients.push({
        id: `recipient-${noticeId}-${user.id}`,
        noticeId,
        userId: user.id,
        emailSnapshot: user.email,
        status: LegalPolicyNoticeRecipientStatus.PENDING,
        attempts: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        providerMessageId: null
      });
      created += 1;
    }
    notice.recipientCursor = page.at(-1)?.id ?? notice.recipientCursor;
    const complete = page.length < take;
    if (complete) notice.recipientsMaterializedAt = now;
    return { created, complete };
  }

  async claimRecipients(noticeId: string, limit: number, now: Date, leaseExpiresAt: Date) {
    const candidates = this.recipients
      .filter(
        (recipient) =>
          recipient.noticeId === noticeId &&
          recipient.attempts < 5 &&
          (recipient.status === LegalPolicyNoticeRecipientStatus.PENDING ||
            (recipient.status === LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE &&
              (!recipient.nextAttemptAt || recipient.nextAttemptAt <= now)) ||
            (recipient.status === LegalPolicyNoticeRecipientStatus.PROCESSING &&
              Boolean(recipient.leaseExpiresAt && recipient.leaseExpiresAt <= now)))
      )
      .slice(0, limit);

    return candidates.map((recipient) => {
      const previousStatus = recipient.status;
      const previousAttempts = recipient.attempts;
      recipient.status = LegalPolicyNoticeRecipientStatus.PROCESSING;
      recipient.attempts += 1;
      recipient.leaseToken = `lease-${this.sequence}-${recipient.id}-${recipient.attempts}`;
      recipient.leaseExpiresAt = leaseExpiresAt;
      recipient.nextAttemptAt = null;
      return {
        id: recipient.id,
        noticeId: recipient.noticeId,
        emailSnapshot: recipient.emailSnapshot,
        attempts: recipient.attempts,
        leaseToken: recipient.leaseToken,
        previousStatus,
        previousAttempts
      };
    });
  }

  async releaseUnattemptedClaims(claims: ClaimedLegalNoticeRecipient[], now: Date) {
    for (const claim of claims) {
      const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
      if (!recipient) continue;
      recipient.status =
        claim.previousStatus === LegalPolicyNoticeRecipientStatus.PROCESSING
          ? LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
          : claim.previousStatus;
      recipient.attempts = claim.previousAttempts;
      recipient.nextAttemptAt = claim.previousStatus === LegalPolicyNoticeRecipientStatus.PROCESSING ? now : null;
      recipient.leaseToken = null;
      recipient.leaseExpiresAt = null;
    }
  }

  async markRecipientSent(claim: ClaimedLegalNoticeRecipient, providerMessageId: string) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return false;
    recipient.status = LegalPolicyNoticeRecipientStatus.SENT;
    recipient.providerMessageId = providerMessageId;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
    return true;
  }

  async markRecipientFailed(
    claim: ClaimedLegalNoticeRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return;
    recipient.status =
      failure.permanent || recipient.attempts >= 5
        ? LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT
        : LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE;
    recipient.nextAttemptAt =
      recipient.status === LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
        ? new Date(now.getTime() + 5 * 60 * 1000)
        : null;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
  }

  async markExhaustedRetriesPermanent(noticeId: string) {
    let count = 0;
    for (const recipient of this.recipients) {
      if (
        recipient.noticeId === noticeId &&
        recipient.status === LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE &&
        recipient.attempts >= 5
      ) {
        recipient.status = LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT;
        count += 1;
      }
    }
    return count;
  }

  async getNoticeProgress(noticeId: string) {
    const notice = this.notices.find((item) => item.id === noticeId);
    const recipients = this.recipients.filter((item) => item.noticeId === noticeId);
    const cursorIndex = notice?.recipientCursor
      ? this.users.findIndex((user) => user.id === notice.recipientCursor)
      : -1;
    const unmaterializedUsers = notice && !notice.recipientsMaterializedAt ? this.users.length - cursorIndex - 1 : 0;
    return {
      materialized: Boolean(notice?.recipientsMaterializedAt),
      remaining:
        recipients.filter((recipient) =>
          new Set<LegalPolicyNoticeRecipientStatus>([
            LegalPolicyNoticeRecipientStatus.PENDING,
            LegalPolicyNoticeRecipientStatus.PROCESSING,
            LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
          ]).has(recipient.status)
        ).length + unmaterializedUsers,
      permanentFailures: recipients.filter(
        (recipient) => recipient.status === LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT
      ).length
    };
  }

  async markNoticeCompleted(noticeId: string) {
    const notice = this.notices.find((item) => item.id === noticeId);
    if (!notice || notice.status !== LegalPolicyNoticeStatus.PROCESSING) return false;
    notice.status = LegalPolicyNoticeStatus.COMPLETED;
    const history = this.histories.get(notice.policy);
    const release = history?.find((item) => item.id === noticeId);
    if (release) release.status = LegalPolicyNoticeStatus.COMPLETED;
    return true;
  }
}

function futurePrivacy(overrides: Partial<LegalPolicy> = {}): LegalPolicy {
  return {
    ...LEGAL_POLICIES.privacy,
    version: "2026-09-01",
    lastUpdated: "September 1, 2026",
    changeSummary: ["Clarified how account data is processed."],
    sections: [
      ...LEGAL_POLICIES.privacy.sections,
      { id: "security-notices", title: "Security notices", paragraphs: ["We may send account security notices."] }
    ],
    ...overrides
  };
}

const runtime = { nodeEnv: "production", vercelEnv: "production", processingEnabled: true };
const noopAudit = vi.fn(async () => undefined);

function acceptingMailer(send = vi.fn()): LegalNoticeMailer & { send: ReturnType<typeof vi.fn> } {
  send.mockImplementation(async () => ({ status: "accepted", providerMessageId: `message-${send.mock.calls.length}` }));
  return { isConfigured: () => true, send };
}

async function establishPrivacyBaseline(store: FakeLegalNoticeStore) {
  await processLegalPolicyNotices({
    store,
    policies: [LEGAL_POLICIES.privacy],
    mailer: acceptingMailer(),
    auditEvent: noopAudit,
    runtime
  });
}

describe("legal policy release detection", () => {
  it("establishes the first registry state as a no-send baseline and then no-ops", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "account@example.com", passwordHash: "hash" }]);
    const mailer = acceptingMailer();

    const first = await processLegalPolicyNotices({
      store,
      policies: LEGAL_POLICY_LIST,
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(first.baselinesCreated).toBe(3);
    expect(first.recipientsSent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();

    const second = await processLegalPolicyNotices({
      store,
      policies: LEGAL_POLICY_LIST,
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(second).toMatchObject({ baselinesCreated: 0, noticesCreated: 0, recipientsSent: 0 });
  });

  it("rejects content edits without a version bump", () => {
    const baseline = LEGAL_POLICIES.privacy;
    const edited: LegalPolicy = {
      ...baseline,
      sections: [...baseline.sections, { id: "edit", title: "Edit", paragraphs: ["Changed."] }]
    };
    expect(
      evaluatePolicyRelease(edited, computeLegalPolicyContentHash(edited), [
        {
          id: "baseline",
          version: baseline.version,
          contentHash: computeLegalPolicyContentHash(baseline),
          status: LegalPolicyNoticeStatus.BASELINE,
          createdAt: new Date()
        }
      ])
    ).toEqual({ action: "error", code: "CONTENT_CHANGED_WITHOUT_VERSION_BUMP" });
  });

  it("rejects a new or reused older version without the required summary", () => {
    const baseline = LEGAL_POLICIES.privacy;
    const history = [
      {
        id: "baseline",
        version: baseline.version,
        contentHash: computeLegalPolicyContentHash(baseline),
        status: LegalPolicyNoticeStatus.BASELINE,
        createdAt: new Date()
      }
    ];
    const noSummary = futurePrivacy({ changeSummary: [] });
    expect(evaluatePolicyRelease(noSummary, computeLegalPolicyContentHash(noSummary), history)).toEqual({
      action: "error",
      code: "CHANGE_SUMMARY_REQUIRED"
    });
    const older = futurePrivacy({ version: "2026-07-01" });
    expect(evaluatePolicyRelease(older, computeLegalPolicyContentHash(older), history)).toEqual({
      action: "error",
      code: "VERSION_NOT_NEWER"
    });
  });
});

describe("recipient selection and idempotent delivery", () => {
  it("cursor-pages account emails without filtering on Google or password login method", async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      { id: "password-user", email: "password@example.com", passwordHash: "hash", googleSub: null },
      { id: "google-user", email: "google@example.com", passwordHash: null, googleSub: "google-sub" }
    ]);
    const page = await getAccountRecipientPage(findMany, { cursor: "previous-user", take: 25 });
    expect(page.map((user) => user.email)).toEqual(["password@example.com", "google@example.com"]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: 25,
      cursor: { id: "previous-user" },
      skip: 1
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("where");
  });

  it("sends one email per account, completes, and never resends a completed notice", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "password@example.com", passwordHash: "hash" },
      { id: "u2", email: "google@example.com", googleSub: "google-sub" },
      { id: "u3", email: "both@example.com", passwordHash: "hash", googleSub: "google-sub-2" }
    ]);
    await establishPrivacyBaseline(store);
    const mailer = acceptingMailer();

    const first = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime,
      batchSize: 2,
      maxPerRun: 10
    });
    expect(first).toMatchObject({ noticesCreated: 1, recipientsMaterialized: 3, recipientsSent: 3, noticesCompleted: 1 });
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(new Set(mailer.send.mock.calls.map((call) => call[0].to)).size).toBe(3);
    expect(store.recipients.filter((recipient) => recipient.status === LegalPolicyNoticeRecipientStatus.SENT)).toHaveLength(3);

    const second = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(second.recipientsSent).toBe(0);
    expect(mailer.send).toHaveBeenCalledTimes(3);
  });

  it("keeps two overlapping processor runs idempotent", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" }
    ]);
    await establishPrivacyBaseline(store);
    const mailer = acceptingMailer();

    await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "preview", processingEnabled: true }
    });

    await Promise.all([
      processLegalPolicyNotices({
        store,
        policies: [futurePrivacy()],
        mailer,
        auditEvent: noopAudit,
        runtime,
        batchSize: 2,
        maxPerRun: 10
      }),
      processLegalPolicyNotices({
        store,
        policies: [futurePrivacy()],
        mailer,
        auditEvent: noopAudit,
        runtime,
        batchSize: 2,
        maxPerRun: 10
      })
    ]);

    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(mailer.send.mock.calls.map((call) => call[0].to).sort()).toEqual([
      "one@example.com",
      "two@example.com"
    ]);
    expect(store.recipients.every((recipient) => recipient.status === LegalPolicyNoticeRecipientStatus.SENT)).toBe(true);
  });

  it("resumes after a transient provider failure without duplicating an already-sent recipient", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" },
      { id: "u3", email: "three@example.com" }
    ]);
    await establishPrivacyBaseline(store);
    let currentTime = new Date("2026-09-01T12:00:00Z");
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: "accepted", providerMessageId: "message-one" })
      .mockResolvedValueOnce({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true })
      .mockResolvedValue({ status: "accepted", providerMessageId: "message-retry" });
    const mailer: LegalNoticeMailer = { isConfigured: () => true, send };

    const interrupted = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime,
      now: () => currentTime,
      batchSize: 3,
      maxPerRun: 10
    });
    expect(interrupted).toMatchObject({ recipientsSent: 1, failures: 1 });
    expect(store.recipients.find((recipient) => recipient.userId === "u1")?.status).toBe(
      LegalPolicyNoticeRecipientStatus.SENT
    );

    currentTime = new Date("2026-09-01T12:10:00Z");
    const resumed = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime,
      now: () => currentTime,
      batchSize: 3,
      maxPerRun: 10
    });
    expect(resumed).toMatchObject({ recipientsSent: 2, noticesCompleted: 1 });
    expect(send.mock.calls.filter((call) => call[0].to === "one@example.com")).toHaveLength(1);
    expect(store.recipients.every((recipient) => recipient.status === LegalPolicyNoticeRecipientStatus.SENT)).toBe(true);
  });

  it("keeps permanent recipient failures isolated from other users", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "bad", email: "invalid@example.com" },
      { id: "good", email: "good@example.com" }
    ]);
    await establishPrivacyBaseline(store);
    const mailer: LegalNoticeMailer = {
      isConfigured: () => true,
      send: vi.fn(async ({ to }) =>
        to === "invalid@example.com"
          ? { status: "permanent" as const, errorCode: "validation_error" }
          : { status: "accepted" as const, providerMessageId: "good-message" }
      )
    };

    const result = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime,
      batchSize: 2,
      maxPerRun: 10
    });
    expect(result).toMatchObject({ recipientsSent: 1, failures: 1, noticesCompleted: 1, recipientsRemaining: 0 });
    expect(store.recipients.find((recipient) => recipient.userId === "bad")?.status).toBe(
      LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT
    );
    expect(store.recipients.find((recipient) => recipient.userId === "good")?.status).toBe(
      LegalPolicyNoticeRecipientStatus.SENT
    );
  });
});

describe("production delivery gate", () => {
  it.each([
    ["development", "development", true],
    ["production", "preview", true],
    ["production", "development", true],
    ["test", "production", true],
    ["production", "production", false]
  ])("blocks node=%s vercel=%s enabled=%s", (nodeEnv, vercelEnv, processingEnabled) => {
    expect(canDeliverLegalPolicyNotices({ nodeEnv, vercelEnv, processingEnabled })).toBe(false);
  });

  it("allows only explicitly enabled Vercel Production delivery", () => {
    expect(
      canDeliverLegalPolicyNotices({ nodeEnv: "production", vercelEnv: "production", processingEnabled: true })
    ).toBe(true);
  });

  it("does not create, materialize, or send a durable release from Preview", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "account@example.com" }]);
    await establishPrivacyBaseline(store);
    const mailer = acceptingMailer();
    const result = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "preview", processingEnabled: true }
    });
    expect(result).toMatchObject({ noticesCreated: 0, deliveryEnabled: false, recipientsSent: 0 });
    expect(store.notices).toEqual([]);
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("records a Production release but does not send while the feature flag is false", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" }
    ]);
    await establishPrivacyBaseline(store);
    const mailer = acceptingMailer();
    const result = await processLegalPolicyNotices({
      store,
      policies: [futurePrivacy()],
      mailer,
      auditEvent: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "production", processingEnabled: false }
    });
    expect(result).toMatchObject({
      noticesCreated: 1,
      deliveryEnabled: false,
      recipientsSent: 0,
      recipientsRemaining: 2
    });
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
