import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory state + swappable mock implementations. Everything lives inside
// vi.hoisted so the hoisted vi.mock factories below can safely reference it.
// No real Gmail, Pub/Sub, Redis, or database is ever touched.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Row = Record<string, any>;

  class PrismaKnownError extends Error {
    code = "P2002";
  }

  class HistoryExpiredError extends Error {
    constructor() {
      super("expired");
      this.name = "GmailHistoryExpiredError";
    }
  }

  class EntityNotFoundError extends Error {
    constructor() {
      super("Gmail entity not found.");
      this.name = "GmailEntityNotFoundError";
    }
  }

  const state = {
    campaigns: [] as Row[],
    senders: [] as Row[],
    suppressions: [] as Row[],
    providerEvents: [] as Row[],
    recipientJobs: [] as Row[],
    inboundReplies: [] as Row[]
  };

  const calls = {
    markRecipientAttempt: [] as Row[],
    syncRunCounts: [] as string[],
    refreshToken: [] as string[],
    dsnCandidateArgs: [] as Row[],
    historyArgs: [] as Row[],
    fullFetches: [] as string[]
  };

  // Per-test swappable behaviors.
  const impl = {
    refreshAccessToken: (async () => ({ access_token: "token-1" })) as (token: string) => Promise<{ access_token: string }>,
    registerWatch: (async () => ({ historyId: "hist-1", expiresAt: new Date("2026-07-08T00:00:00Z") })) as () => Promise<Row>,
    listHistory: (async () => ({ messageIds: [] as string[], latestHistoryId: "hist-2" })) as (args: Row) => Promise<Row>,
    profileHistoryId: async () => "hist-profile",
    fetchMetadata: (async () => ({ id: "dsn-1", payload: { headers: [] } })) as (token: string, id: string) => Promise<Row>,
    fetchFull: (async () => ({ id: "dsn-1", payload: {} })) as (token: string, id: string) => Promise<Row>,
    listDsnCandidates: (async () => [] as string[]) as (args: Row) => Promise<string[]>,
    listThreadMessageIds: (async () => [] as string[]) as (args: Row) => Promise<string[]>
  };

  let idCounter = 0;
  const nextId = () => `row_${++idCounter}`;

  const prismaMock = {
    senderProfile: {
      findFirst: async ({ where }: Row) =>
        state.senders.find((row) => row.id === where.id && (!where.provider || row.provider === where.provider)) ?? null,
      findMany: async ({ where, take }: Row) => {
        const notIn: string[] = where?.gmailWatchStatus?.notIn ?? [];
        return state.senders
          .filter((row) => row.provider === "google_oauth" && row.oauthRefreshToken)
          .filter((row) => !notIn.includes(row.gmailWatchStatus))
          .slice(0, take ?? 100);
      },
      update: async ({ where, data }: Row) => {
        const row = state.senders.find((entry) => entry.id === where.id);
        if (row) {
          Object.assign(row, data);
        }
        return row;
      }
    },
    campaign: {
      findFirst: async ({ where }: Row) =>
        state.campaigns.find(
          (row) =>
            row.id === where.id &&
            (!where.userId || row.userId === where.userId) &&
            (!where.senderProfileId || row.senderProfileId === where.senderProfileId)
        ) ?? null
    },
    suppression: {
      findUnique: async ({ where }: Row) => {
        const key = where.userId_email;
        return state.suppressions.find((row) => row.userId === key.userId && row.email === key.email) ?? null;
      },
      update: async ({ where, data }: Row) => {
        const row = state.suppressions.find((entry) => entry.id === where.id);
        if (!row) throw new Error("suppression not found");
        const { failureCount, ...rest } = data;
        Object.assign(row, rest);
        if (failureCount?.increment) {
          row.failureCount = (row.failureCount ?? 0) + failureCount.increment;
        }
        return { ...row };
      },
      create: async ({ data }: Row) => {
        const row = { id: nextId(), ...data };
        state.suppressions.push(row);
        return { ...row };
      }
    },
    providerEvent: {
      findUnique: async ({ where }: Row) => {
        const key = where.provider_providerMessageId_eventType;
        return (
          state.providerEvents.find(
            (row) =>
              row.provider === key.provider &&
              row.providerMessageId === key.providerMessageId &&
              row.eventType === key.eventType
          ) ?? null
        );
      },
      create: async ({ data }: Row) => {
        const exists = state.providerEvents.some(
          (row) =>
            row.provider === data.provider &&
            row.providerMessageId === data.providerMessageId &&
            row.eventType === data.eventType
        );
        if (exists) throw new PrismaKnownError("duplicate");
        const row = { id: nextId(), ...data };
        state.providerEvents.push(row);
        return { ...row };
      }
    },
    inboundReply: {
      findUnique: async ({ where }: Row) =>
        state.inboundReplies.find((row) => row.gmailMessageId === where.gmailMessageId) ?? null,
      delete: async ({ where }: Row) => {
        const index = state.inboundReplies.findIndex((row) => row.id === where.id);
        const [removed] = index >= 0 ? state.inboundReplies.splice(index, 1) : [null];
        return removed;
      },
      findMany: async ({ where, take }: Row) =>
        state.inboundReplies
          .filter((row) => row.recipientJobId === where.recipientJobId)
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .slice(0, take ?? 100)
          .map((row) => ({ ...row })),
      count: async ({ where }: Row) =>
        state.inboundReplies.filter((row) => row.recipientJobId === where.recipientJobId).length
    },
    recipientJob: {
      findUnique: async ({ where }: Row) => {
        const row = state.recipientJobs.find((entry) => entry.id === where.id);
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: Row) => {
        const row = state.recipientJobs.find((entry) => entry.id === where.id);
        if (!row) throw new Error("job not found");
        Object.assign(row, data);
        return { ...row };
      },
      findMany: async ({ where, take }: Row) => {
        let rows = state.recipientJobs;
        if (typeof where?.status === "string") {
          rows = rows.filter((row) => row.status === where.status);
        }
        if (where?.status?.in) {
          rows = rows.filter((row) => where.status.in.includes(row.status));
        }
        if (where?.metadata?.path) {
          const key = where.metadata.path[0];
          rows = rows.filter((row) => (row.metadata as Row | null)?.[key] === where.metadata.equals);
        }
        if (where?.recipientEmail?.equals) {
          rows = rows.filter((row) => row.recipientEmail.toLowerCase() === where.recipientEmail.equals.toLowerCase());
        }
        if (where?.campaignRun?.campaign?.userId) {
          rows = rows.filter((row) => row.userId === where.campaignRun.campaign.userId);
        }
        if (where?.campaignRun?.campaign?.senderProfileId) {
          rows = rows.filter((row) => row.senderProfileId === where.campaignRun.campaign.senderProfileId);
        }
        if (where?.campaignRun?.campaign?.id) {
          rows = rows.filter((row) => row.campaignId === where.campaignRun.campaign.id);
        }
        if (where?.createdAt?.gte) {
          rows = rows.filter((row) => (row.createdAt ?? new Date()).getTime() >= where.createdAt.gte.getTime());
        }
        return rows.slice(0, take ?? rows.length).map((row) => ({ ...row }));
      },
      updateMany: async ({ where, data }: Row) => {
        const ids: string[] = where.id.in;
        let count = 0;
        for (const row of state.recipientJobs) {
          if (ids.includes(row.id)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prismaMock)
  };

  return { state, calls, impl, prismaMock, PrismaKnownError, HistoryExpiredError, EntityNotFoundError, nextId };
});

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: h.PrismaKnownError }
}));

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async () => "OK",
    eval: async () => 1
  })
}));

vi.mock("@/lib/google", () => ({
  GOOGLE_GMAIL_REPLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  refreshGoogleAccessToken: (token: string) => {
    h.calls.refreshToken.push(token);
    return h.impl.refreshAccessToken(token);
  }
}));

vi.mock("@/lib/gmail", () => ({
  GmailHistoryExpiredError: h.HistoryExpiredError,
  GmailEntityNotFoundError: h.EntityNotFoundError,
  isGmailNotFoundError: (error: unknown) =>
    error instanceof h.EntityNotFoundError ||
    (error instanceof Error && /requested entity was not found|not_found/i.test(error.message)),
  normalizeMessageId: (value?: string | null) => value?.replace(/[<>]/g, "").trim().toLowerCase() || null,
  registerGmailWatch: () => h.impl.registerWatch(),
  listGmailHistoryMessageIds: (args: Record<string, unknown>) => {
    h.calls.historyArgs.push(args);
    return h.impl.listHistory(args);
  },
  getGmailProfileHistoryId: () => h.impl.profileHistoryId(),
  fetchGmailDsnFilterMetadata: (token: string, id: string) => h.impl.fetchMetadata(token, id),
  fetchGmailMessageFull: (token: string, id: string) => {
    h.calls.fullFetches.push(id);
    return h.impl.fetchFull(token, id);
  },
  listGmailDsnCandidateIds: (args: Record<string, unknown>) => {
    h.calls.dsnCandidateArgs.push(args);
    return h.impl.listDsnCandidates(args);
  },
  listGmailThreadMessageIds: (args: Record<string, unknown>) => h.impl.listThreadMessageIds(args)
}));

vi.mock("@/services/campaigns", () => ({
  markRecipientAttempt: async (args: Record<string, unknown>) => {
    h.calls.markRecipientAttempt.push(args);
    return {};
  },
  syncRunCounts: async (runId: string) => {
    h.calls.syncRunCounts.push(runId);
    return {};
  }
}));

vi.mock("@/lib/provider", () => ({
  isGmailReconnectError: (error: unknown) => error instanceof Error && error.message.includes("invalid_grant")
}));

vi.mock("@/lib/env", () => ({
  env: { GMAIL_PUBSUB_TOPIC: "projects/test/topics/gmail" }
}));

import {
  ensureGmailWatch,
  processPotentialBounceMessage,
  recordDeliveryFailureSuppression,
  renewExpiringGmailWatches,
  repairHardBouncedRecipientDispositions,
  resolveBounceMonitoringStatus,
  runRecentBounceBackfill,
  runSequenceBounceScan,
  skipQueuedSendsForFailedAddress,
  syncSenderBounces
} from "@/services/bounces";

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const { state, calls, impl } = h;

function seedSender(overrides: Record<string, any> = {}) {
  const sender: Record<string, any> = {
    id: "sender-1",
    userId: "user-1",
    fromEmail: "kush@techsmail.com",
    provider: "google_oauth",
    oauthRefreshToken: "refresh-1",
    oauthScope: `openid email https://www.googleapis.com/auth/gmail.send ${READ_SCOPE}`,
    gmailWatchHistoryId: null,
    gmailWatchExpiresAt: null,
    gmailWatchStatus: null,
    gmailWatchError: null,
    bounceLastSyncedAt: null,
    bounceBackfillCompletedAt: null,
    ...overrides
  };
  state.senders.push(sender);
  return sender;
}

function seedCampaign(overrides: Record<string, any> = {}) {
  const campaign: Record<string, any> = {
    id: "campaign-1",
    userId: "user-1",
    senderProfileId: "sender-1",
    createdAt: new Date("2026-07-08T18:00:00Z"),
    updatedAt: new Date("2026-07-08T19:00:00Z"),
    runs: [
      {
        id: "run-1",
        createdAt: new Date("2026-07-08T18:00:00Z"),
        scheduledFor: null,
        startedAt: new Date("2026-07-08T19:10:00Z"),
        completedAt: null,
        updatedAt: new Date("2026-07-08T19:30:00Z")
      }
    ],
    ...overrides
  };
  state.campaigns.push(campaign);
  return campaign;
}

function seedJob(overrides: Record<string, any> = {}) {
  const job: Record<string, any> = {
    id: h.nextId(),
    campaignRunId: "run-1",
    recipientEmail: "nmarshall@paychex.com",
    providerMessageId: "gmail-sent-1",
    status: "SENT",
    replyCount: 0,
    metadata: { rfcMessageId: "sendloom-abc123@techsmail.com" },
    createdAt: new Date("2026-07-08T19:10:00Z"),
    updatedAt: new Date(),
    userId: "user-1",
    campaignId: "campaign-1",
    senderProfileId: "sender-1",
    ...overrides
  };
  state.recipientJobs.push(job);
  return job;
}

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function bounceMetadata() {
  return {
    id: "dsn-1",
    payload: {
      headers: [
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        { name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="x"' },
        { name: "X-Failed-Recipients", value: "nmarshall@paychex.com" }
      ]
    }
  };
}

function bounceFull(args: { status?: string; diagnostic?: string; recipient?: string; references?: string } = {}) {
  const statusBody = [
    "Reporting-MTA: dns; googlemail.com",
    "",
    `Final-Recipient: rfc822; ${args.recipient ?? "nmarshall@paychex.com"}`,
    "Action: failed",
    `Status: ${args.status ?? "5.1.1"}`,
    `Diagnostic-Code: smtp; ${args.diagnostic ?? "550 5.1.1 User Unknown"}`
  ].join("\r\n");
  return {
    id: "dsn-1",
    threadId: "thread-1",
    internalDate: String(Date.now()),
    sizeEstimate: 4000,
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "From", value: "mailer-daemon@googlemail.com" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        { name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="x"' },
        ...(args.references ? [{ name: "References", value: args.references }] : [])
      ],
      parts: [{ mimeType: "message/delivery-status", body: { size: statusBody.length, data: b64(statusBody) } }]
    }
  };
}

async function processBounce(sender: Record<string, any>, jobs: Record<string, any>[]) {
  return processPotentialBounceMessage({
    sender: { id: sender.id, userId: sender.userId, fromEmail: sender.fromEmail },
    accessToken: "token-1",
    gmailMessageId: "dsn-1",
    jobs: jobs as never,
    threadCache: new Map()
  });
}

beforeEach(() => {
  state.campaigns.length = 0;
  state.senders.length = 0;
  state.suppressions.length = 0;
  state.providerEvents.length = 0;
  state.recipientJobs.length = 0;
  state.inboundReplies.length = 0;
  calls.markRecipientAttempt.length = 0;
  calls.syncRunCounts.length = 0;
  calls.refreshToken.length = 0;
  calls.dsnCandidateArgs.length = 0;
  calls.historyArgs.length = 0;
  calls.fullFetches.length = 0;
  impl.refreshAccessToken = async () => ({ access_token: "token-1" });
  impl.registerWatch = async () => ({ historyId: "hist-1", expiresAt: new Date("2026-07-08T00:00:00Z") });
  impl.listHistory = async () => ({ messageIds: [], latestHistoryId: "hist-2" });
  impl.profileHistoryId = async () => "hist-profile";
  impl.fetchMetadata = async () => ({ id: "dsn-1", payload: { headers: [] } });
  impl.fetchFull = async () => ({ id: "dsn-1", payload: {} });
  impl.listDsnCandidates = async () => [];
  impl.listThreadMessageIds = async () => [];
});

// ---------------------------------------------------------------------------
// Capability status
// ---------------------------------------------------------------------------

describe("bounce-monitoring capability", () => {
  it("requires the mailbox-read scope (senders without it keep sending)", () => {
    const sender = seedSender({ oauthScope: "openid email https://www.googleapis.com/auth/gmail.send" });
    expect(resolveBounceMonitoringStatus(sender as never)).toBe("PERMISSION_REQUIRED");
  });

  it("marks reconnect when the token is gone and unavailable for non-Gmail providers", () => {
    expect(resolveBounceMonitoringStatus(seedSender({ oauthRefreshToken: null }) as never)).toBe("RECONNECT_REQUIRED");
    expect(resolveBounceMonitoringStatus(seedSender({ id: "s2", provider: "resend" }) as never)).toBe("UNAVAILABLE");
  });

  it("is active with scope + token, and degrades on renewal failure", () => {
    expect(resolveBounceMonitoringStatus(seedSender() as never)).toBe("ACTIVE");
    expect(resolveBounceMonitoringStatus(seedSender({ id: "s2", gmailWatchStatus: "RENEWAL_FAILED" }) as never)).toBe(
      "RENEWAL_FAILED"
    );
  });
});

// ---------------------------------------------------------------------------
// DSN processing: suppression, correlation, idempotency
// ---------------------------------------------------------------------------

describe("bounce processing", () => {
  it("permanent 5.1.1 bounce suppresses, SKIPS the matched job, and skips queued sends", async () => {
    const sender = seedSender();
    const sent = seedJob();
    const queued = seedJob({ id: "queued-1", status: "PENDING", providerMessageId: null, campaignRunId: "run-2" });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    const { outcome } = await processBounce(sender, [sent]);

    expect(outcome).toBe("processed");
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      userId: "user-1",
      email: "nmarshall@paychex.com",
      reason: "HARD_BOUNCE",
      source: "gmail-dsn",
      enhancedStatusCode: "5.1.1",
      failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND",
      failureCount: 1,
      sourceGmailMessageId: "dsn-1"
    });
    expect(calls.markRecipientAttempt).toHaveLength(1);
    // The disposition is Skipped (SUPPRESSED) — a bad ADDRESS is never
    // presented as a Sendloom failure. The bounce evidence stays in metadata.
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: sent.id,
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT",
      lastError: "Address not found"
    });
    // Queued future attempts carry the same concise reason.
    expect(queued.status).toBe("SUPPRESSED");
    expect(queued.lastError).toBe("Address not found");
    // Already-sent history is untouched.
    expect(sent.status).toBe("SENT");
  });

  it("heals a job that already FAILED at send time into the Skipped disposition", async () => {
    const sender = seedSender();
    const failed = seedJob({
      status: "FAILED",
      metadata: { rfcMessageId: "sendloom-abc123@techsmail.com", failureCode: "GMAIL_SEND_REJECTED" }
    });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    const { outcome } = await processBounce(sender, [failed]);

    expect(outcome).toBe("processed");
    expect(state.suppressions).toHaveLength(1);
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: failed.id,
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT"
    });
  });

  it("classifies Exchange 550 5.4.1 recipient access denial as Invalid, not a failed send", async () => {
    const sender = seedSender();
    const failed = seedJob({
      status: "FAILED",
      metadata: { rfcMessageId: "sendloom-abc123@techsmail.com", failureCode: "GMAIL_SEND_REJECTED" },
      lastError: "Gmail rejected this recipient."
    });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({
        status: "5.4.1",
        diagnostic: "550 5.4.1 Recipient address rejected: Access denied",
        references: "<sendloom-abc123@techsmail.com>"
      });

    const result = await processBounce(sender, [failed]);

    expect(result).toMatchObject({ outcome: "processed", permanentFailures: 1, temporaryFailures: 0 });
    expect(state.suppressions[0]).toMatchObject({
      reason: "HARD_BOUNCE",
      enhancedStatusCode: "5.4.1",
      failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND"
    });
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: failed.id,
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT",
      lastError: "Address not found"
    });
  });

  it("heals a falsely-OPENED recipient — a hard-bounced message was never delivered, so its 'open' is bogus", async () => {
    const sender = seedSender();
    // Gmail's image proxy fetches the tracking pixel again when the sender
    // views the bounce report (it quotes the original message), which used to
    // leave hard-bounced recipients stuck as OPENED/"Delivered".
    const opened = seedJob({ status: "OPENED", metadata: { rfcMessageId: "sendloom-abc123@techsmail.com" } });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [opened]);

    expect(state.suppressions).toHaveLength(1);
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: opened.id,
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT"
    });
  });

  it("never rewrites a recipient with a real reply or a CLICKED recipient from a bounce", async () => {
    const sender = seedSender();
    const replied = seedJob({
      status: "OPENED",
      replyCount: 1,
      metadata: { rfcMessageId: "sendloom-abc123@techsmail.com" }
    });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [replied]);

    // The suppression is still recorded (the ADDRESS is bad for future sends)
    // but strong engagement evidence protects the job's disposition.
    expect(state.suppressions).toHaveLength(1);
    expect(calls.markRecipientAttempt).toHaveLength(0);
    expect(replied.status).toBe("OPENED");

    state.suppressions.length = 0;
    state.providerEvents.length = 0;
    const clicked = seedJob({ status: "CLICKED", metadata: { rfcMessageId: "sendloom-abc123@techsmail.com" } });
    await processBounce(sender, [clicked]);
    expect(calls.markRecipientAttempt).toHaveLength(0);
    expect(clicked.status).toBe("CLICKED");
  });

  it("correlates by RFC Message-ID before falling back to recipient matching", async () => {
    const sender = seedSender();
    const byRfc = seedJob({ id: "job-rfc", metadata: { rfcMessageId: "sendloom-abc123@techsmail.com" } });
    const decoy = seedJob({ id: "job-decoy", recipientEmail: "nmarshall@paychex.com", metadata: {}, providerMessageId: "gmail-sent-2" });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [decoy, byRfc]);
    expect(calls.markRecipientAttempt[0]).toMatchObject({ jobId: "job-rfc" });
  });

  it("correlates through the Gmail thread when no RFC reference exists", async () => {
    const sender = seedSender();
    const sent = seedJob({ metadata: {} });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ recipient: "someone-else@paychex.com" });
    impl.listThreadMessageIds = async () => ["gmail-sent-1"];

    await processBounce(sender, [sent]);
    expect(calls.markRecipientAttempt[0]).toMatchObject({ jobId: sent.id });
  });

  it("an unmatched bounce records a diagnostic but never changes recipient state", async () => {
    const sender = seedSender();
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ recipient: "stranger@example.com" });

    const { outcome } = await processBounce(sender, []);

    expect(outcome).toBe("unmatched");
    expect(state.suppressions).toHaveLength(0);
    expect(calls.markRecipientAttempt).toHaveLength(0);
    // Recorded for internal investigation — without the recipient address.
    expect(state.providerEvents).toHaveLength(1);
    expect(JSON.stringify(state.providerEvents[0].payload)).not.toContain("stranger@example.com");
  });

  it("another sender's jobs can never be matched (candidate lists are sender-scoped)", async () => {
    const sender = seedSender();
    // A job belonging to a different user/sender is simply not in the candidate
    // list the service loads for this sender.
    seedJob({ id: "other-user-job", userId: "user-2", senderProfileId: "sender-2" });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull();

    const { outcome } = await processBounce(sender, []);
    expect(outcome).toBe("unmatched");
    expect(state.recipientJobs.find((row) => row.id === "other-user-job")?.status).toBe("SENT");
  });

  it("duplicate bounce processing is idempotent end to end", async () => {
    const sender = seedSender();
    const sent = seedJob();
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull({ references: "<sendloom-abc123@techsmail.com>" });

    expect((await processBounce(sender, [sent])).outcome).toBe("processed");
    expect((await processBounce(sender, [sent])).outcome).toBe("duplicate");
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0].failureCount).toBe(1);
    expect(calls.markRecipientAttempt).toHaveLength(1);
  });

  it("manual sequence repair can reprocess an already-recorded DSN and heal a generic failed row by exact email", async () => {
    const sender = seedSender();
    const failed = seedJob({
      id: "generic-failed",
      status: "FAILED",
      providerMessageId: null,
      recipientEmail: "luna_y@example.com",
      metadata: { failureCode: "GMAIL_SEND_REJECTED" },
      lastError: "Gmail rejected this recipient."
    });
    state.providerEvents.push({
      id: "event-1",
      provider: "gmail-dsn",
      providerMessageId: "dsn-1",
      eventType: "BOUNCED",
      payload: {}
    });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({
        recipient: "luna_y@example.com",
        status: "5.1.0",
        diagnostic: "550 #5.1.0 Address rejected"
      });

    const result = await processPotentialBounceMessage({
      sender: { id: sender.id, userId: sender.userId, fromEmail: sender.fromEmail },
      accessToken: "token-1",
      gmailMessageId: "dsn-1",
      jobs: [failed] as never,
      threadCache: new Map(),
      allowDuplicateRepair: true
    });

    expect(result.outcome).toBe("processed");
    expect(state.providerEvents).toHaveLength(1);
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: "generic-failed",
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT",
      lastError: "Address not found"
    });
    expect(state.suppressions[0]).toMatchObject({
      userId: "user-1",
      email: "luna_y@example.com",
      reason: "HARD_BOUNCE",
      enhancedStatusCode: "5.1.0"
    });
  });

  it("temporary 4.x.x failures neither suppress nor change the attempt", async () => {
    const sender = seedSender();
    const sent = seedJob();
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({ status: "4.2.2", diagnostic: "mailbox is full", references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [sent]);
    expect(state.suppressions).toHaveLength(0);
    expect(calls.markRecipientAttempt).toHaveLength(0);
    expect(sent.status).toBe("SENT");
  });

  it("policy/spam rejections fail the attempt but never suppress the address", async () => {
    const sender = seedSender();
    const sent = seedJob();
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({ status: "5.7.1", diagnostic: "Message rejected due to policy", references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [sent]);
    expect(state.suppressions).toHaveLength(0);
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: sent.id,
      status: "FAILED",
      failureCode: "GMAIL_SEND_REJECTED"
    });
  });

  it("sender quota failures never suppress the recipient", async () => {
    const sender = seedSender();
    const sent = seedJob();
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({ status: "5.4.5", diagnostic: "Daily sending quota for the sender exceeded", references: "<sendloom-abc123@techsmail.com>" });

    await processBounce(sender, [sent]);
    expect(state.suppressions).toHaveLength(0);
  });

  it("ordinary messages are dismissed at the metadata pass without a body fetch", async () => {
    const sender = seedSender();
    impl.fetchMetadata = async () => ({
      id: "dsn-1",
      payload: { headers: [{ name: "From", value: "friend@example.com" }, { name: "Subject", value: "Lunch?" }] }
    });

    expect((await processBounce(sender, [])).outcome).toBe("not-dsn");
    expect(calls.fullFetches).toHaveLength(0);
    expect(state.providerEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suppression persistence detail
// ---------------------------------------------------------------------------

describe("delivery-failure suppression persistence", () => {
  const base = {
    userId: "user-1",
    email: "Bad.Address@Example.com ",
    category: "HARD_BOUNCE_MAILBOX_NOT_FOUND" as const,
    enhancedStatusCode: "5.1.1",
    occurredAt: new Date("2026-06-28T00:00:00Z")
  };

  it("normalizes the email and counts distinct bounces once each", async () => {
    await recordDeliveryFailureSuppression({ ...base, sourceGmailMessageId: "m1" });
    await recordDeliveryFailureSuppression({ ...base, sourceGmailMessageId: "m1" });
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0].email).toBe("bad.address@example.com");
    expect(state.suppressions[0].failureCount).toBe(1);

    await recordDeliveryFailureSuppression({ ...base, sourceGmailMessageId: "m2" });
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0].failureCount).toBe(2);
    expect(state.suppressions[0].firstFailedAt).toEqual(base.occurredAt);
  });

  it("never relabels an unsubscribe as a failure", async () => {
    state.suppressions.push({
      id: "sup-1",
      userId: "user-1",
      email: "bad.address@example.com",
      reason: "UNSUBSCRIBED",
      source: "unsubscribe-link",
      failureCount: 0,
      firstFailedAt: null
    });
    await recordDeliveryFailureSuppression({ ...base, sourceGmailMessageId: "m9" });
    expect(state.suppressions[0].reason).toBe("UNSUBSCRIBED");
    expect(state.suppressions[0].source).toBe("unsubscribe-link");
    // The structured failure detail is still recorded.
    expect(state.suppressions[0].failureCategory).toBe("HARD_BOUNCE_MAILBOX_NOT_FOUND");
  });

  it("skips only queued attempts for the failed address, never sent history", async () => {
    const sent = seedJob({ status: "SENT" });
    const pending = seedJob({ id: "p1", status: "PENDING" });
    const retrying = seedJob({ id: "r1", status: "RETRYING" });
    const otherUser = seedJob({ id: "o1", status: "PENDING", userId: "user-2" });

    const result = await skipQueuedSendsForFailedAddress({
      userId: "user-1",
      email: "NMARSHALL@paychex.com",
      reason: "Address not found"
    });

    expect(result.skippedCount).toBe(2);
    expect(sent.status).toBe("SENT");
    expect(pending.status).toBe("SUPPRESSED");
    expect(retrying.status).toBe("SUPPRESSED");
    expect(otherUser.status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Watch lifecycle + history sync
// ---------------------------------------------------------------------------

describe("gmail watch lifecycle", () => {
  it("registration stores expiration and anchors the history id only once", async () => {
    const sender = seedSender();

    expect(await ensureGmailWatch(sender.id)).toBe(true);
    expect(sender.gmailWatchStatus).toBe("ACTIVE");
    expect(sender.gmailWatchExpiresAt).toEqual(new Date("2026-07-08T00:00:00Z"));
    expect(sender.gmailWatchHistoryId).toBe("hist-1");

    // A later renewal must never move an existing pointer.
    sender.gmailWatchHistoryId = "hist-processed";
    impl.registerWatch = async () => ({ historyId: "hist-9", expiresAt: new Date("2026-07-09T00:00:00Z") });
    await ensureGmailWatch(sender.id);
    expect(sender.gmailWatchHistoryId).toBe("hist-processed");
  });

  it("marks missing permission and revoked authorization distinctly", async () => {
    const noScope = seedSender({ id: "s-noscope", oauthScope: "https://www.googleapis.com/auth/gmail.send" });
    expect(await ensureGmailWatch(noScope.id)).toBe(false);
    expect(noScope.gmailWatchStatus).toBe("PERMISSION_REQUIRED");

    const revoked = seedSender({ id: "s-revoked" });
    impl.refreshAccessToken = async () => {
      throw new Error("invalid_grant");
    };
    expect(await ensureGmailWatch(revoked.id)).toBe(false);
    expect(revoked.gmailWatchStatus).toBe("RECONNECT_REQUIRED");
  });

  it("renewal sweeps expiring watches and flags transient failures", async () => {
    seedSender({ id: "s1" });
    impl.registerWatch = async () => {
      throw new Error("backend unavailable");
    };
    const result = await renewExpiringGmailWatches();
    expect(result.sendersChecked).toBe(1);
    expect(result.failed).toBe(1);
    expect(state.senders[0].gmailWatchStatus).toBe("RENEWAL_FAILED");
  });

  it("first sync anchors at the profile history id without scanning anything", async () => {
    const sender = seedSender();
    const result = await syncSenderBounces(sender.id, { force: true });
    expect(result.checkedMessages).toBe(0);
    expect(sender.gmailWatchHistoryId).toBe("hist-profile");
    expect(calls.historyArgs).toHaveLength(0);
  });

  it("incremental sync advances the pointer only after processing", async () => {
    const sender = seedSender({ gmailWatchHistoryId: "hist-1" });
    impl.listHistory = async () => ({ messageIds: ["dsn-1"], latestHistoryId: "hist-2" });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull();

    const result = await syncSenderBounces(sender.id, { force: true });
    expect(result.checkedMessages).toBe(1);
    expect(sender.gmailWatchHistoryId).toBe("hist-2");
    expect(sender.bounceLastSyncedAt).toBeInstanceOf(Date);
  });

  it("an out-of-date history id triggers ONE bounded DSN-only recovery scan", async () => {
    const sender = seedSender({ gmailWatchHistoryId: "hist-old" });
    impl.listHistory = async () => {
      throw new h.HistoryExpiredError();
    };
    impl.listDsnCandidates = async () => ["dsn-1"];
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => bounceFull();

    const result = await syncSenderBounces(sender.id, { force: true });
    expect(result.recovered).toBe(true);
    // Recovery uses the narrow DSN candidate query with a bounded window+cap.
    expect(calls.dsnCandidateArgs).toHaveLength(1);
    expect(calls.dsnCandidateArgs[0]).toMatchObject({ newerThanDays: 7, maxResults: 100 });
    expect(sender.gmailWatchHistoryId).toBe("hist-profile");
  });

  it("a failing token refresh during backfill degrades to reconnect-required, never a thrown provider error", async () => {
    const sender = seedSender();
    impl.refreshAccessToken = async () => {
      // Google's token endpoint can answer with an unclassified 400 ("Bad
      // Request") for a stale refresh token — exactly what production hit.
      throw new Error("Bad Request");
    };
    const result = await runRecentBounceBackfill(sender.id);
    expect(result.skipped).toBe("reconnect_required");
    expect(sender.gmailWatchStatus).toBe("RECONNECT_REQUIRED");
    // Not marked complete — a later successful attempt still runs.
    expect(sender.bounceBackfillCompletedAt).toBeNull();
  });

  it("revoked authorization during sync requests reconnect instead of throwing", async () => {
    const sender = seedSender({ gmailWatchHistoryId: "hist-1" });
    impl.refreshAccessToken = async () => {
      throw new Error("invalid_grant");
    };
    const result = await syncSenderBounces(sender.id, { force: true });
    expect(result.skipped).toBe("reconnect_required");
    expect(sender.gmailWatchStatus).toBe("RECONNECT_REQUIRED");
  });
});

describe("manual sequence bounce scan", () => {
  it("searches a bounded sequence window and repairs already-ingested bounces for this sequence only", async () => {
    seedSender();
    seedCampaign();
    seedJob({
      id: "sequence-failed",
      status: "FAILED",
      providerMessageId: null,
      recipientEmail: "will_hsu@example.com",
      metadata: { failureCode: "GMAIL_SEND_REJECTED" },
      lastError: "Gmail rejected this recipient."
    });
    seedJob({
      id: "other-sequence",
      campaignId: "campaign-2",
      status: "FAILED",
      providerMessageId: null,
      recipientEmail: "will_hsu@example.com",
      metadata: { failureCode: "GMAIL_SEND_REJECTED" },
      lastError: "Gmail rejected this recipient."
    });
    state.providerEvents.push({
      id: "event-1",
      provider: "gmail-dsn",
      providerMessageId: "dsn-1",
      eventType: "BOUNCED",
      payload: {}
    });
    impl.listDsnCandidates = async () => ["dsn-1"];
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({
        recipient: "will_hsu@example.com",
        status: "5.1.1",
        diagnostic: "550 5.1.1 user unknown"
      });

    const result = await runSequenceBounceScan({
      campaignId: "campaign-1",
      userId: "user-1",
      senderId: "sender-1"
    });

    expect(result.checkedMessages).toBe(1);
    expect(result.bouncesParsed).toBe(1);
    expect(result.processedBounces).toBe(1);
    expect(calls.dsnCandidateArgs).toHaveLength(1);
    expect(calls.dsnCandidateArgs[0]).toMatchObject({ maxResults: 200 });
    expect(calls.dsnCandidateArgs[0].after).toBeInstanceOf(Date);
    expect(calls.dsnCandidateArgs[0].before).toBeInstanceOf(Date);
    expect(calls.dsnCandidateArgs[0].newerThanDays).toBeUndefined();
    expect(calls.markRecipientAttempt).toHaveLength(1);
    expect(calls.markRecipientAttempt[0]).toMatchObject({ jobId: "sequence-failed", status: "SUPPRESSED" });
    expect(calls.markRecipientAttempt.map((call) => call.jobId)).toEqual(["sequence-failed"]);
  });
});

// ---------------------------------------------------------------------------
// Missing Gmail entities (404 "Requested entity was not found") — a message or
// thread the search/history listed can be deleted before we read it. Each
// missing entity is skipped; the scan keeps going and never throws.
// ---------------------------------------------------------------------------

describe("missing Gmail entities are skipped, not fatal", () => {
  it("skips a messages.get 404 (metadata) and keeps scanning the rest of the batch", async () => {
    seedSender();
    seedCampaign();
    seedJob({ id: "sequence-hit", recipientEmail: "nmarshall@paychex.com", providerMessageId: null });
    impl.listDsnCandidates = async () => ["dsn-missing", "dsn-1"];
    impl.fetchMetadata = async (_token: string, id: string) => {
      if (id === "dsn-missing") {
        throw new h.EntityNotFoundError();
      }
      return bounceMetadata();
    };
    impl.fetchFull = async () => bounceFull();

    const result = await runSequenceBounceScan({ campaignId: "campaign-1", userId: "user-1", senderId: "sender-1" });

    // The whole batch was inspected, the missing one counted, the real one parsed.
    expect(result.checkedMessages).toBe(2);
    expect(result.missingMessageCount).toBe(1);
    expect(result.bouncesParsed).toBe(1);
  });

  it("skips a messages.get 404 on the full-body fetch too", async () => {
    seedSender();
    seedCampaign();
    seedJob({ id: "sequence-hit", recipientEmail: "nmarshall@paychex.com", providerMessageId: null });
    impl.listDsnCandidates = async () => ["dsn-1"];
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => {
      throw new h.EntityNotFoundError();
    };

    const result = await runSequenceBounceScan({ campaignId: "campaign-1", userId: "user-1", senderId: "sender-1" });

    expect(result.checkedMessages).toBe(1);
    expect(result.missingMessageCount).toBe(1);
    expect(result.bouncesParsed).toBe(0);
  });

  it("counts a threads.get 404 and falls back to email correlation without throwing", async () => {
    seedSender();
    seedCampaign();
    // The DSN carries no matching RFC reference, forcing the thread lookup path.
    const job = seedJob({
      id: "thread-fallback",
      recipientEmail: "nmarshall@paychex.com",
      providerMessageId: "gmail-thread-msg",
      metadata: {}
    });
    impl.listDsnCandidates = async () => ["dsn-1"];
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () =>
      bounceFull({ recipient: "nmarshall@paychex.com", status: "5.1.1", references: "<no-match@techsmail.com>" });
    impl.listThreadMessageIds = async () => {
      throw new h.EntityNotFoundError();
    };

    const result = await runSequenceBounceScan({ campaignId: "campaign-1", userId: "user-1", senderId: "sender-1" });

    expect(result.missingThreadCount).toBe(1);
    // Email fallback still correlated the bounce to the recipient's job.
    expect(calls.markRecipientAttempt.map((call) => call.jobId)).toContain(job.id);
  });

  it("propagates a non-404 Gmail error (not swallowed as a missing entity)", async () => {
    const sender = seedSender({ gmailWatchHistoryId: "hist-1" });
    impl.listHistory = async () => ({ messageIds: ["dsn-1"], latestHistoryId: "hist-2" });
    impl.fetchMetadata = async () => {
      throw new Error("Gmail backend error (500).");
    };

    await expect(syncSenderBounces(sender.id, { force: true })).rejects.toThrow("Gmail backend error");
  });
});

// ---------------------------------------------------------------------------
// Missed-bounce regression — the real "550 5.1.0 Address Rejected" failure.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

describe("missed-bounce regression (550 5.1.0 Address Rejected)", () => {
  function optumBounceFull() {
    return bounceFull({
      recipient: "mohshin.chowdhury@optum.com",
      status: "5.1.0",
      diagnostic: "550 5.1.0 Address Rejected",
      references: "<sendloom-optum1@techsmail.com>"
    });
  }

  it("first sync runs the bounded recent scan and catches a bounce that predates monitoring", async () => {
    const sender = seedSender(); // no gmailWatchHistoryId — first sync
    seedJob({
      id: "optum-job",
      recipientEmail: "mohshin.chowdhury@optum.com",
      metadata: { rfcMessageId: "sendloom-optum1@techsmail.com" }
    });
    impl.listDsnCandidates = async () => ["dsn-1"];
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => optumBounceFull();

    const result = await syncSenderBounces(sender.id, { force: true });

    // The cursor is anchored AND the recent DSN scan ran with a bounded window.
    expect(sender.gmailWatchHistoryId).toBe("hist-profile");
    expect(calls.dsnCandidateArgs).toHaveLength(1);
    expect(calls.dsnCandidateArgs[0]).toMatchObject({ newerThanDays: 7, maxResults: 100 });
    expect(result.processedBounces).toBe(1);
    expect(result.permanentFailures).toBe(1);
    // The pre-existing bounce produced a real suppression — not skipped forever.
    expect(state.suppressions[0]).toMatchObject({
      email: "mohshin.chowdhury@optum.com",
      reason: "HARD_BOUNCE",
      enhancedStatusCode: "5.1.0"
    });
    expect(calls.markRecipientAttempt[0]).toMatchObject({
      jobId: "optum-job",
      status: "SUPPRESSED",
      failureCode: "HARD_BOUNCE_RECIPIENT"
    });
  });

  it("a DSN previously stored as a human reply is healed when the bounce is processed", async () => {
    const sender = seedSender();
    const job = seedJob({
      id: "optum-job",
      recipientEmail: "mohshin.chowdhury@optum.com",
      metadata: { rfcMessageId: "sendloom-optum1@techsmail.com" },
      replyCount: 1,
      repliedAt: new Date("2026-07-03T21:37:00Z")
    });
    // The exact production symptom: repliesStored: 1 for the bounce message.
    state.inboundReplies.push({
      id: "bogus-reply",
      gmailMessageId: "dsn-1",
      recipientJobId: job.id,
      receivedAt: new Date("2026-07-03T21:37:00Z")
    });
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => optumBounceFull();

    const { outcome } = await processBounce(sender, [job]);

    expect(outcome).toBe("processed");
    // The bogus reply is gone and the job's reply counters are corrected.
    expect(state.inboundReplies).toHaveLength(0);
    expect(job.replyCount).toBe(0);
    expect(job.repliedAt).toBeNull();
    expect(calls.syncRunCounts).toContain(job.campaignRunId);
    // And the bounce itself was still recorded as a permanent failure.
    expect(state.suppressions).toHaveLength(1);
  });

  it("healing never touches genuine replies on the same job", async () => {
    const sender = seedSender();
    const job = seedJob({
      id: "optum-job",
      metadata: { rfcMessageId: "sendloom-optum1@techsmail.com" },
      replyCount: 2,
      repliedAt: new Date("2026-07-03T22:00:00Z")
    });
    state.inboundReplies.push(
      { id: "real-reply", gmailMessageId: "real-1", recipientJobId: job.id, receivedAt: new Date("2026-07-03T22:00:00Z") },
      { id: "bogus-reply", gmailMessageId: "dsn-1", recipientJobId: job.id, receivedAt: new Date("2026-07-03T21:37:00Z") }
    );
    impl.fetchMetadata = async () => bounceMetadata();
    impl.fetchFull = async () => optumBounceFull();

    await processBounce(sender, [job]);

    expect(state.inboundReplies.map((row) => row.id)).toEqual(["real-reply"]);
    expect(job.replyCount).toBe(1);
    expect(job.repliedAt).toEqual(new Date("2026-07-03T22:00:00Z"));
  });
});

// ---------------------------------------------------------------------------
// Orchestration + cursor-independence contracts (source assertions).
// ---------------------------------------------------------------------------

describe("bounce/reply orchestration contracts", () => {
  const cronSource = readFileSync("src/app/api/cron/campaigns/route.ts", "utf8");
  const repliesSource = readFileSync("src/services/replies.ts", "utf8");
  const bouncesSource = readFileSync("src/services/bounces.ts", "utf8");
  const gmailSource = readFileSync("src/lib/gmail.ts", "utf8");

  it("the campaign cron invokes bounce sync and watch renewal in their own try/catch", () => {
    expect(cronSource).toContain("syncDueSenderBounces()");
    expect(cronSource).toContain("renewExpiringGmailWatches()");
    // Reply-sync failure cannot prevent bounce sync (separate catch blocks).
    expect(cronSource).toMatch(/catch[\s\S]*reply-sync[\s\S]*try[\s\S]*renewExpiringGmailWatches/);
    expect(cronSource).toMatch(/catch[\s\S]*gmail-watch-renewal[\s\S]*try[\s\S]*syncDueSenderBounces/);
  });

  it("the cron fallback never depends on Pub/Sub configuration", () => {
    const fallback = bouncesSource.slice(
      bouncesSource.indexOf("export async function syncDueSenderBounces"),
      bouncesSource.indexOf("export async function handleGmailPushNotification")
    );
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback).not.toContain("GMAIL_PUBSUB_TOPIC");
  });

  it("reply sync and bounce sync keep fully independent cursors", () => {
    // Reply sync windows on lastReplySyncAt timestamps; bounce sync advances a
    // Gmail history id. Neither reads or writes the other's cursor, so one can
    // never consume mailbox events the other still needs.
    expect(repliesSource).not.toContain("gmailWatchHistoryId");
    expect(bouncesSource).not.toContain("lastReplySyncAt");
  });

  it("reply candidates exclude delivery notifications before matching", () => {
    expect(gmailSource).toContain("looksLikeDeliveryNotification");
    // The exclusion happens inside mapReplyCandidate, before references are read.
    const mapper = gmailSource.slice(
      gmailSource.indexOf("function mapReplyCandidate"),
      gmailSource.indexOf("export async function listGmailReplyCandidates")
    );
    expect(mapper.indexOf("looksLikeDeliveryNotification")).toBeGreaterThan(-1);
    expect(mapper.indexOf("looksLikeDeliveryNotification")).toBeLessThan(mapper.indexOf("extractMessageIds"));
    // The metadata fetch requests the headers the exclusion needs.
    expect(gmailSource).toContain('"Auto-Submitted"');
    expect(gmailSource).toContain('"X-Failed-Recipients"');
  });

  it("bounce sync emits the safe operational summary (no recipient addresses)", () => {
    expect(bouncesSource).toContain("[bounce-sync] Processed Gmail delivery notifications.");
    expect(bouncesSource).toContain("[bounce-sync] Permanent delivery failure recorded.");
    expect(bouncesSource).toContain("[bounce-sync] Delivery notification could not be correlated.");
    const logBlock = bouncesSource.slice(
      bouncesSource.indexOf("function logBounceSyncSummary"),
      bouncesSource.indexOf("export async function syncSenderBounces")
    );
    expect(logBlock).not.toMatch(/email/i);
  });
});

// ---------------------------------------------------------------------------
// Disposition repair — recipients recorded as FAILED by the older mapping.
// ---------------------------------------------------------------------------

describe("hard-bounce disposition repair", () => {
  it("converts only permanent hard-bounce FAILED rows to Skipped, keeping the evidence", async () => {
    const bounced = seedJob({
      id: "old-bounce",
      status: "FAILED",
      lastError: "The address returned a permanent delivery failure and is excluded from future sends.",
      metadata: { failureCode: "HARD_BOUNCE_RECIPIENT", failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND" }
    });
    const serverError = seedJob({
      id: "server-error",
      status: "FAILED",
      lastError: "Couldn't send the email right now.",
      metadata: { failureCode: "QUEUE_PROCESSING_FAILED" }
    });
    const authError = seedJob({
      id: "auth-error",
      status: "FAILED",
      metadata: { failureCode: "GMAIL_PROFILE_DISCONNECTED" }
    });
    const temporary = seedJob({ id: "temp", status: "RETRYING", metadata: { failureCode: "GMAIL_RATE_LIMITED" } });

    const result = await repairHardBouncedRecipientDispositions();

    expect(result.repairedCount).toBe(1);
    // The invalid ADDRESS reads as Skipped with a concise reason…
    expect(bounced.status).toBe("SUPPRESSED");
    expect(bounced.lastError).toBe("Address not found");
    // …while the bounce evidence stays untouched in metadata.
    expect(bounced.metadata).toMatchObject({
      failureCode: "HARD_BOUNCE_RECIPIENT",
      failureCategory: "HARD_BOUNCE_MAILBOX_NOT_FOUND"
    });
    // Real operational failures keep their Failed status.
    expect(serverError.status).toBe("FAILED");
    expect(authError.status).toBe("FAILED");
    expect(temporary.status).toBe("RETRYING");
    // Run counts were recalculated for the touched run.
    expect(calls.syncRunCounts).toContain(bounced.campaignRunId);
  });

  it("is idempotent — a second pass finds nothing to repair", async () => {
    seedJob({
      id: "old-bounce",
      status: "FAILED",
      metadata: { failureCode: "HARD_BOUNCE_RECIPIENT", failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT" }
    });
    expect((await repairHardBouncedRecipientDispositions()).repairedCount).toBe(1);
    expect((await repairHardBouncedRecipientDispositions()).repairedCount).toBe(0);
  });
});
