import { LegalPolicyNoticeRecipientStatus, LegalPolicyNoticeStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    LEGAL_NOTICE_BATCH_SIZE: 25,
    LEGAL_NOTICE_MAX_PER_RUN: 50,
    LEGAL_NOTICE_PROCESSING_ENABLED: false
  }
}));

import { computeLegalPolicyContentHash } from "@/lib/legal-policy-fingerprint";
import {
  canDeliverLegalPolicyNotices,
  evaluatePolicyRelease,
  getAccountRecipientPage,
  processLegalPolicyNotices,
  type ClaimedLegalReleaseRecipient,
  type LegalNoticeRecord,
  type LegalNoticeStore,
  type LegalPolicyReleaseRecord
} from "@/lib/legal-policy-notifications";
import { LEGAL_POLICIES, LEGAL_POLICY_LIST, type LegalPolicy } from "@/lib/legal-policies";
import type { LegalNoticeMailer } from "@/lib/legal-notice-email";

type FakeUser = {
  id: string;
  email: string;
  passwordHash?: string | null;
  googleSub?: string | null;
};

type FakeReleaseRecipient = {
  id: string;
  releaseId: string;
  userId: string;
  emailSnapshot: string;
  status: LegalPolicyNoticeRecipientStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
};

type FakeLegacyRecipient = {
  noticeId: string;
  userId: string;
  status: LegalPolicyNoticeRecipientStatus;
  providerMessageId: string | null;
  sentAt: Date | null;
};

class FakeLegalNoticeStore implements LegalNoticeStore {
  histories = new Map<string, Awaited<ReturnType<LegalNoticeStore["listPolicyHistory"]>>>();
  notices: LegalNoticeRecord[] = [];
  releases: LegalPolicyReleaseRecord[] = [];
  recipients: FakeReleaseRecipient[] = [];
  legacyRecipients: FakeLegacyRecipient[] = [];
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
    const release = {
      id: `baseline-${policy.id}`,
      version: policy.version,
      contentHash,
      status: LegalPolicyNoticeStatus.BASELINE,
      createdAt: new Date("2026-08-23T00:00:00Z")
    };
    this.histories.set(policy.id, [release, ...(this.histories.get(policy.id) ?? [])]);
    return true;
  }

  private findOrCreateRelease(releaseGroup: string) {
    const existing = this.releases.find((release) => release.releaseGroup === releaseGroup);
    if (existing) return { release: existing, created: false };
    this.sequence += 1;
    const release: LegalPolicyReleaseRecord = {
      id: `release-${this.sequence}`,
      releaseGroup,
      status: LegalPolicyNoticeStatus.PENDING,
      recipientCursor: null,
      recipientsMaterializedAt: null,
      notices: []
    };
    this.releases.push(release);
    return { release, created: true };
  }

  async createNotice(policy: LegalPolicy, contentHash: string) {
    if ((this.histories.get(policy.id) ?? []).some((item) => item.version === policy.version)) {
      return { noticeCreated: false, releaseCreated: false };
    }
    const grouped = this.findOrCreateRelease(policy.releaseGroup);
    this.sequence += 1;
    const id = `notice-${this.sequence}`;
    const createdAt = new Date(`2026-09-01T00:00:${String(this.sequence).padStart(2, "0")}Z`);
    this.histories.set(policy.id, [
      { id, version: policy.version, contentHash, status: LegalPolicyNoticeStatus.PENDING, createdAt },
      ...(this.histories.get(policy.id) ?? [])
    ]);
    const notice: LegalNoticeRecord = {
      id,
      policy: policy.id,
      version: policy.version,
      policyTitle: policy.title,
      policyPath: policy.path,
      contentHash,
      lastUpdated: policy.lastUpdated,
      changeSummary: [...policy.changeSummary],
      status: LegalPolicyNoticeStatus.PENDING,
      releaseId: grouped.release.id
    };
    this.notices.push(notice);
    grouped.release.notices.push(notice);
    return { noticeCreated: true, releaseCreated: grouped.created };
  }

  async ensureNoticeRelease(policy: LegalPolicy, noticeId: string) {
    const notice = this.notices.find((item) => item.id === noticeId);
    if (!notice) return { releaseCreated: false, conflict: true };
    const grouped = this.findOrCreateRelease(policy.releaseGroup);
    if (notice.releaseId && notice.releaseId !== grouped.release.id) {
      return { releaseCreated: false, conflict: true };
    }
    notice.releaseId = grouped.release.id;
    if (!grouped.release.notices.some((item) => item.id === notice.id)) grouped.release.notices.push(notice);
    return { releaseCreated: grouped.created, conflict: false };
  }

  listActiveReleases() {
    return Promise.resolve(
      this.releases.filter(
        (release) =>
          release.notices.length > 0 &&
          (release.status === LegalPolicyNoticeStatus.PENDING ||
            release.status === LegalPolicyNoticeStatus.PROCESSING)
      )
    );
  }

  async markReleaseProcessing(releaseId: string) {
    const release = this.releases.find((item) => item.id === releaseId);
    if (!release) return { releaseStarted: false, noticesStarted: 0 };
    const releaseStarted = release.status === LegalPolicyNoticeStatus.PENDING;
    if (releaseStarted) release.status = LegalPolicyNoticeStatus.PROCESSING;
    let noticesStarted = 0;
    for (const notice of release.notices) {
      if (notice.status !== LegalPolicyNoticeStatus.PENDING) continue;
      notice.status = LegalPolicyNoticeStatus.PROCESSING;
      const history = this.histories.get(notice.policy)?.find((item) => item.id === notice.id);
      if (history) history.status = LegalPolicyNoticeStatus.PROCESSING;
      noticesStarted += 1;
    }
    return { releaseStarted, noticesStarted };
  }

  async materializeRecipientPage(releaseId: string, take: number, now: Date) {
    const release = this.releases.find((item) => item.id === releaseId);
    if (!release || release.recipientsMaterializedAt) return { created: 0, complete: true };
    const start = release.recipientCursor
      ? Math.max(
          this.users.findIndex((user) => user.id === release.recipientCursor) + 1,
          0
        )
      : 0;
    const page = this.users.slice(start, start + take);
    let created = 0;
    for (const user of page) {
      if (this.recipients.some((recipient) => recipient.releaseId === releaseId && recipient.userId === user.id)) {
        continue;
      }
      const legacy = this.legacyRecipients.find(
        (recipient) =>
          recipient.userId === user.id &&
          recipient.status === LegalPolicyNoticeRecipientStatus.SENT &&
          release.notices.some((notice) => notice.id === recipient.noticeId)
      );
      this.recipients.push({
        id: `recipient-${releaseId}-${user.id}`,
        releaseId,
        userId: user.id,
        emailSnapshot: user.email,
        status: legacy ? LegalPolicyNoticeRecipientStatus.SENT : LegalPolicyNoticeRecipientStatus.PENDING,
        attempts: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        providerMessageId: legacy?.providerMessageId ?? null,
        sentAt: legacy?.sentAt ?? null
      });
      created += 1;
    }
    release.recipientCursor = page.at(-1)?.id ?? release.recipientCursor;
    const complete = page.length < take;
    if (complete) release.recipientsMaterializedAt = now;
    return { created, complete };
  }

  async claimRecipients(releaseId: string, limit: number, now: Date, leaseExpiresAt: Date) {
    const candidates = this.recipients
      .filter(
        (recipient) =>
          recipient.releaseId === releaseId &&
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
      recipient.leaseToken = `lease-${recipient.id}-${recipient.attempts}`;
      recipient.leaseExpiresAt = leaseExpiresAt;
      recipient.nextAttemptAt = null;
      return {
        id: recipient.id,
        releaseId: recipient.releaseId,
        userId: recipient.userId,
        emailSnapshot: recipient.emailSnapshot,
        attempts: recipient.attempts,
        leaseToken: recipient.leaseToken,
        previousStatus,
        previousAttempts
      };
    });
  }

  async releaseUnattemptedClaims(claims: ClaimedLegalReleaseRecipient[], now: Date) {
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

  async markRecipientSent(claim: ClaimedLegalReleaseRecipient, providerMessageId: string, now: Date) {
    const recipient = this.recipients.find((item) => item.id === claim.id && item.leaseToken === claim.leaseToken);
    if (!recipient) return false;
    recipient.status = LegalPolicyNoticeRecipientStatus.SENT;
    recipient.providerMessageId = providerMessageId;
    recipient.sentAt = now;
    recipient.leaseToken = null;
    recipient.leaseExpiresAt = null;
    return true;
  }

  async markRecipientFailed(
    claim: ClaimedLegalReleaseRecipient,
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

  async markExhaustedRetriesPermanent(releaseId: string) {
    let count = 0;
    for (const recipient of this.recipients) {
      if (
        recipient.releaseId === releaseId &&
        recipient.status === LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE &&
        recipient.attempts >= 5
      ) {
        recipient.status = LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT;
        count += 1;
      }
    }
    return count;
  }

  async getReleaseProgress(releaseId: string) {
    const release = this.releases.find((item) => item.id === releaseId);
    const recipients = this.recipients.filter((item) => item.releaseId === releaseId);
    const cursorIndex = release?.recipientCursor
      ? this.users.findIndex((user) => user.id === release.recipientCursor)
      : -1;
    const unmaterializedUsers =
      release && !release.recipientsMaterializedAt ? this.users.length - cursorIndex - 1 : 0;
    return {
      materialized: Boolean(release?.recipientsMaterializedAt),
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

  async markReleaseCompleted(releaseId: string) {
    const release = this.releases.find((item) => item.id === releaseId);
    if (!release || release.status !== LegalPolicyNoticeStatus.PROCESSING) {
      return { releaseCompleted: false, noticesCompleted: 0 };
    }
    release.status = LegalPolicyNoticeStatus.COMPLETED;
    let noticesCompleted = 0;
    for (const notice of release.notices) {
      if (
        notice.status !== LegalPolicyNoticeStatus.PENDING &&
        notice.status !== LegalPolicyNoticeStatus.PROCESSING
      ) {
        continue;
      }
      notice.status = LegalPolicyNoticeStatus.COMPLETED;
      const history = this.histories.get(notice.policy)?.find((item) => item.id === notice.id);
      if (history) history.status = LegalPolicyNoticeStatus.COMPLETED;
      noticesCompleted += 1;
    }
    return { releaseCompleted: true, noticesCompleted };
  }

  seedExistingNotice(policy: LegalPolicy, status: LegalPolicyNoticeStatus) {
    this.sequence += 1;
    const id = `legacy-notice-${policy.id}`;
    const notice: LegalNoticeRecord = {
      id,
      policy: policy.id,
      version: policy.version,
      policyTitle: policy.title,
      policyPath: policy.path,
      contentHash: computeLegalPolicyContentHash(policy),
      lastUpdated: policy.lastUpdated,
      changeSummary: [...policy.changeSummary],
      status,
      releaseId: null
    };
    this.notices.push(notice);
    this.histories.set(policy.id, [
      {
        id,
        version: policy.version,
        contentHash: notice.contentHash,
        status,
        createdAt: new Date("2026-08-23T12:00:00Z")
      }
    ]);
    return notice;
  }
}

function futurePolicy(policy: LegalPolicy, releaseGroup: string, version = "2026-09-01"): LegalPolicy {
  return {
    ...policy,
    version,
    releaseGroup,
    lastUpdated: "September 1, 2026",
    changeSummary: [`Updated ${policy.title}.`],
    sections: [
      ...policy.sections,
      { id: `future-${policy.id}`, title: "Future change", paragraphs: [`New ${policy.title} text.`] }
    ]
  };
}

const runtime = { nodeEnv: "production", vercelEnv: "production", processingEnabled: true };
const noopAudit = vi.fn(async () => undefined);

function acceptingMailer(send = vi.fn()): LegalNoticeMailer & { send: ReturnType<typeof vi.fn> } {
  send.mockImplementation(async () => ({ status: "accepted", providerMessageId: `message-${send.mock.calls.length}` }));
  return { isConfigured: () => true, send };
}

async function establishBaselines(store: FakeLegalNoticeStore, policies: readonly LegalPolicy[] = LEGAL_POLICY_LIST) {
  await processLegalPolicyNotices({
    store,
    policies,
    mailer: acceptingMailer(),
    auditEvent: noopAudit,
    runtime
  });
}

describe("legal policy release detection and grouping", () => {
  it("establishes first-seen policies as no-send baselines", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "account@example.com" }]);
    const mailer = acceptingMailer();
    const result = await processLegalPolicyNotices({
      store,
      policies: LEGAL_POLICY_LIST,
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(result).toMatchObject({ baselinesCreated: 3, noticesCreated: 0, releasesCreated: 0, recipientsSent: 0 });
    expect(store.releases).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("groups three changed policies into one release and one email per user", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "password", email: "password@example.com", passwordHash: "hash" },
      { id: "google", email: "google@example.com", googleSub: "google-sub" }
    ]);
    await establishBaselines(store);
    const mailer = acceptingMailer();
    const policies = LEGAL_POLICY_LIST.map((item) => futurePolicy(item, "2026-09-01-policy-refresh"));
    const result = await processLegalPolicyNotices({
      store,
      policies,
      mailer,
      auditEvent: noopAudit,
      runtime,
      batchSize: 2,
      maxPerRun: 10
    });

    expect(result).toMatchObject({
      noticesCreated: 3,
      releasesCreated: 1,
      releasesCompleted: 1,
      recipientsMaterialized: 2,
      recipientsSent: 2
    });
    expect(store.releases).toHaveLength(1);
    expect(store.releases[0].notices).toHaveLength(3);
    expect(store.recipients).toHaveLength(2);
    expect(mailer.send).toHaveBeenCalledTimes(2);
    for (const call of mailer.send.mock.calls) {
      expect(call[0].policies.map((policy: { id: string }) => policy.id).sort()).toEqual(["abuse", "privacy", "terms"]);
      expect(call[0].releaseGroup).toBe("2026-09-01-policy-refresh");
      expect(call[0].idempotencyKey).toMatch(/^legal-release-release-\d+-(password|google)$/);
    }
  });

  it("groups two policies while leaving an unchanged policy out", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "one@example.com" }]);
    await establishBaselines(store);
    const mailer = acceptingMailer();
    await processLegalPolicyNotices({
      store,
      policies: [
        futurePolicy(LEGAL_POLICIES.terms, "two-policy-release"),
        futurePolicy(LEGAL_POLICIES.privacy, "two-policy-release"),
        LEGAL_POLICIES.abuse
      ],
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(store.releases).toHaveLength(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0].policies.map((item: { id: string }) => item.id).sort()).toEqual([
      "privacy",
      "terms"
    ]);
  });

  it("creates one release for one changed policy and separate releases for different groups", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "one@example.com" }]);
    await establishBaselines(store);
    const mailer = acceptingMailer();
    await processLegalPolicyNotices({
      store,
      policies: [
        futurePolicy(LEGAL_POLICIES.terms, "terms-release"),
        futurePolicy(LEGAL_POLICIES.privacy, "privacy-release")
      ],
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(store.releases.map((release) => release.releaseGroup).sort()).toEqual([
      "privacy-release",
      "terms-release"
    ]);
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(mailer.send.mock.calls.every((call) => call[0].policies.length === 1)).toBe(true);
  });

  it("rejects content edits without a version bump and requires a summary for a new version", () => {
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
    const edited = futurePolicy(baseline, "same-version", baseline.version);
    expect(evaluatePolicyRelease(edited, computeLegalPolicyContentHash(edited), history)).toEqual({
      action: "error",
      code: "CONTENT_CHANGED_WITHOUT_VERSION_BUMP"
    });
    const noSummary: LegalPolicy = {
      ...futurePolicy(baseline, "future", "2026-09-02"),
      changeSummary: []
    };
    expect(evaluatePolicyRelease(noSummary, computeLegalPolicyContentHash(noSummary), history)).toEqual({
      action: "error",
      code: "CHANGE_SUMMARY_REQUIRED"
    });
  });
});

describe("release recipient selection, idempotency, and retries", () => {
  it("cursor-pages account emails without auth-method or connected-sender filters", async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      { id: "password-user", email: "password@example.com", passwordHash: "hash", googleSub: null },
      { id: "google-user", email: "google@example.com", passwordHash: null, googleSub: "google-sub" },
      { id: "both-user", email: "both@example.com", passwordHash: "hash", googleSub: "google-both" }
    ]);
    const page = await getAccountRecipientPage(findMany, { cursor: "previous-user", take: 25 });
    expect(page.map((user) => user.email)).toEqual([
      "password@example.com",
      "google@example.com",
      "both@example.com"
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: 25,
      cursor: { id: "previous-user" },
      skip: 1
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("where");
  });

  it("running twice and concurrently never duplicates a user/release delivery", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" }
    ]);
    await establishBaselines(store, [LEGAL_POLICIES.privacy]);
    const mailer = acceptingMailer();
    const updated = futurePolicy(LEGAL_POLICIES.privacy, "privacy-release");

    await Promise.all([
      processLegalPolicyNotices({ store, policies: [updated], mailer, auditEvent: noopAudit, runtime }),
      processLegalPolicyNotices({ store, policies: [updated], mailer, auditEvent: noopAudit, runtime })
    ]);
    await processLegalPolicyNotices({ store, policies: [updated], mailer, auditEvent: noopAudit, runtime });

    expect(store.releases).toHaveLength(1);
    expect(store.recipients).toHaveLength(2);
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(new Set(mailer.send.mock.calls.map((call) => call[0].idempotencyKey)).size).toBe(2);
    expect(store.recipients.every((recipient) => recipient.status === LegalPolicyNoticeRecipientStatus.SENT)).toBe(true);
  });

  it("retries the same combined release without resending an accepted recipient", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "u1", email: "one@example.com" },
      { id: "u2", email: "two@example.com" },
      { id: "u3", email: "three@example.com" }
    ]);
    await establishBaselines(store);
    let currentTime = new Date("2026-09-01T12:00:00Z");
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: "accepted", providerMessageId: "message-one" })
      .mockResolvedValueOnce({ status: "retryable", errorCode: "rate_limit_exceeded", stopRun: true })
      .mockResolvedValue({ status: "accepted", providerMessageId: "message-retry" });
    const mailer: LegalNoticeMailer = { isConfigured: () => true, send };
    const policies = LEGAL_POLICY_LIST.map((item) => futurePolicy(item, "combined-retry"));

    await processLegalPolicyNotices({
      store,
      policies,
      mailer,
      auditEvent: noopAudit,
      runtime,
      now: () => currentTime,
      batchSize: 3,
      maxPerRun: 10
    });
    currentTime = new Date("2026-09-01T12:10:00Z");
    const resumed = await processLegalPolicyNotices({
      store,
      policies,
      mailer,
      auditEvent: noopAudit,
      runtime,
      now: () => currentTime,
      batchSize: 3,
      maxPerRun: 10
    });

    expect(resumed).toMatchObject({ recipientsSent: 2, releasesCompleted: 1 });
    expect(send.mock.calls.filter((call) => call[0].to === "one@example.com")).toHaveLength(1);
    expect(send.mock.calls.every((call) => call[0].policies.length === 3)).toBe(true);
  });

  it("isolates a permanent failure and counts max-per-run as emails", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "bad", email: "invalid@example.com" },
      { id: "good", email: "good@example.com" }
    ]);
    await establishBaselines(store);
    const mailer: LegalNoticeMailer = {
      isConfigured: () => true,
      send: vi.fn(async ({ to }) =>
        to === "invalid@example.com"
          ? { status: "permanent" as const, errorCode: "validation_error" }
          : { status: "accepted" as const, providerMessageId: "good-message" }
      )
    };
    const policies = LEGAL_POLICY_LIST.map((item) => futurePolicy(item, "combined-permanent"));
    const result = await processLegalPolicyNotices({
      store,
      policies,
      mailer,
      auditEvent: noopAudit,
      runtime,
      batchSize: 3,
      maxPerRun: 2
    });
    expect(result).toMatchObject({ recipientsSent: 1, failures: 1, releasesCompleted: 1, recipientsRemaining: 0 });
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });
});

describe("legacy August 23 transition", () => {
  it("suppresses the combined email after any successful member-policy send and preserves legacy history", async () => {
    const store = new FakeLegalNoticeStore([
      { id: "already", email: "already@example.com" },
      { id: "new", email: "new@example.com" }
    ]);
    const notices = LEGAL_POLICY_LIST.map((policy) =>
      store.seedExistingNotice(policy, LegalPolicyNoticeStatus.PROCESSING)
    );
    const legacySentAt = new Date("2026-08-23T13:00:00Z");
    store.legacyRecipients.push({
      noticeId: notices[1].id,
      userId: "already",
      status: LegalPolicyNoticeRecipientStatus.SENT,
      providerMessageId: "historic-provider-message",
      sentAt: legacySentAt
    });
    store.legacyRecipients.push({
      noticeId: notices[0].id,
      userId: "new",
      status: LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE,
      providerMessageId: null,
      sentAt: null
    });
    const legacySnapshot = structuredClone(store.legacyRecipients);
    const mailer = acceptingMailer();

    const result = await processLegalPolicyNotices({
      store,
      policies: LEGAL_POLICY_LIST,
      mailer,
      auditEvent: noopAudit,
      runtime,
      batchSize: 2,
      maxPerRun: 10
    });

    expect(result).toMatchObject({ noticesCreated: 0, releasesCreated: 1, recipientsSent: 1, releasesCompleted: 1 });
    expect(store.releases).toHaveLength(1);
    expect(store.releases[0].releaseGroup).toBe("2026-08-23-v2-combined-policy-notice");
    expect(store.releases[0].notices).toHaveLength(3);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com" }));
    expect(store.recipients.find((recipient) => recipient.userId === "already")).toMatchObject({
      status: LegalPolicyNoticeRecipientStatus.SENT,
      providerMessageId: "historic-provider-message",
      sentAt: legacySentAt
    });
    expect(store.legacyRecipients).toEqual(legacySnapshot);
  });

  it("does not resend a fully completed historical release", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "one@example.com" }]);
    const notices = LEGAL_POLICY_LIST.map((policy) =>
      store.seedExistingNotice(policy, LegalPolicyNoticeStatus.COMPLETED)
    );
    for (const notice of notices) {
      store.legacyRecipients.push({
        noticeId: notice.id,
        userId: "u1",
        status: LegalPolicyNoticeRecipientStatus.SENT,
        providerMessageId: `provider-${notice.policy}`,
        sentAt: new Date("2026-08-23T13:00:00Z")
      });
    }
    const mailer = acceptingMailer();
    await processLegalPolicyNotices({
      store,
      policies: LEGAL_POLICY_LIST,
      mailer,
      auditEvent: noopAudit,
      runtime
    });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(store.releases[0].status).toBe(LegalPolicyNoticeStatus.COMPLETED);
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
    await establishBaselines(store, [LEGAL_POLICIES.privacy]);
    const mailer = acceptingMailer();
    const result = await processLegalPolicyNotices({
      store,
      policies: [futurePolicy(LEGAL_POLICIES.privacy, "preview-release")],
      mailer,
      auditEvent: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "preview", processingEnabled: true }
    });
    expect(result).toMatchObject({ noticesCreated: 0, releasesCreated: 0, deliveryEnabled: false, recipientsSent: 0 });
    expect(store.releases).toEqual([]);
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("records a Production release but does not send while the flag is false", async () => {
    const store = new FakeLegalNoticeStore([{ id: "u1", email: "one@example.com" }]);
    await establishBaselines(store, [LEGAL_POLICIES.privacy]);
    const mailer = acceptingMailer();
    const result = await processLegalPolicyNotices({
      store,
      policies: [futurePolicy(LEGAL_POLICIES.privacy, "disabled-release")],
      mailer,
      auditEvent: noopAudit,
      runtime: { nodeEnv: "production", vercelEnv: "production", processingEnabled: false }
    });
    expect(result).toMatchObject({ noticesCreated: 1, releasesCreated: 1, recipientsSent: 0, recipientsRemaining: 1 });
    expect(store.recipients).toEqual([]);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
