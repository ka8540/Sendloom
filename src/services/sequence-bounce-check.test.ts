import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory campaign/job state; the Gmail sync and reclassification services
// are mocked with swappable behaviors so each test controls what the bounce
// pipeline "finds". No real Gmail, redis, or database is touched.
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    campaigns: [] as Row[],
    jobs: [] as Row[]
  };
  const calls = {
    backfill: [] as string[],
    sync: [] as Row[],
    reclassify: [] as Row[]
  };
  const emptySyncResult = () => ({
    checkedMessages: 0,
    bouncesParsed: 0,
    processedBounces: 0,
    unmatchedBounces: 0,
    permanentFailures: 0,
    temporaryFailures: 0,
    recovered: false
  });
  const impl = {
    backfill: (async () => emptySyncResult()) as (senderId: string) => Promise<Row>,
    sync: (async () => emptySyncResult()) as (senderId: string, options?: Row) => Promise<Row>,
    reclassify: (async () => ({
      scanned: 0,
      candidates: [],
      reclassifiedCount: 0,
      suppressionsRecordedCount: 0
    })) as (options: Row) => Promise<Row>
  };
  const prismaMock = {
    campaign: {
      findFirst: async ({ where }: Row) =>
        state.campaigns.find((row) => row.id === where.id && row.userId === where.userId) ?? null
    },
    recipientJob: {
      findMany: async ({ where }: Row) =>
        state.jobs
          .filter((row) => row.campaignId === where.campaignRun.campaignId)
          .map((row) => ({ status: row.status, metadata: row.metadata ?? null, lastError: row.lastError ?? null }))
    }
  };
  return { state, calls, impl, prismaMock, emptySyncResult };
});

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));
vi.mock("@/services/bounces", () => ({
  runRecentBounceBackfill: (senderId: string) => {
    h.calls.backfill.push(senderId);
    return h.impl.backfill(senderId);
  },
  syncSenderBounces: (senderId: string, options?: Record<string, unknown>) => {
    h.calls.sync.push({ senderId, options });
    return h.impl.sync(senderId, options);
  }
}));
vi.mock("@/services/invalid-recipient-reclassification", () => ({
  reclassifyInvalidRecipientJobs: (options: Record<string, unknown>) => {
    h.calls.reclassify.push(options);
    return h.impl.reclassify(options);
  }
}));

import { checkSequenceBounces } from "@/services/sequence-bounce-check";

const { state, calls, impl } = h;

function seedCampaign(overrides: Record<string, any> = {}) {
  const campaign = {
    id: "campaign-1",
    userId: "user-1",
    senderProfileId: "sender-1",
    senderProfile: { provider: "google_oauth", oauthRefreshToken: "refresh-1" },
    ...overrides
  };
  state.campaigns.push(campaign);
  return campaign;
}

function seedJobs(count: number, status: string, campaignId = "campaign-1") {
  for (let index = 0; index < count; index += 1) {
    state.jobs.push({ campaignId, status });
  }
}

beforeEach(() => {
  state.campaigns.length = 0;
  state.jobs.length = 0;
  calls.backfill.length = 0;
  calls.sync.length = 0;
  calls.reclassify.length = 0;
  impl.backfill = async () => h.emptySyncResult();
  impl.sync = async () => h.emptySyncResult();
  impl.reclassify = async () => ({ scanned: 0, candidates: [], reclassifiedCount: 0, suppressionsRecordedCount: 0 });
});

describe("checkSequenceBounces", () => {
  it("requires sequence ownership — another user's campaign is not found and nothing runs", async () => {
    seedCampaign({ userId: "someone-else" });

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result.status).toBe("not_found");
    expect(calls.sync).toHaveLength(0);
    expect(calls.reclassify).toHaveLength(0);
  });

  it("returns a safe disconnected state without touching Gmail when the sender has no token", async () => {
    seedCampaign({ senderProfile: { provider: "google_oauth", oauthRefreshToken: null } });

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result.status).toBe("sender_disconnected");
    expect(calls.backfill).toHaveLength(0);
    expect(calls.sync).toHaveLength(0);
  });

  it("reports non-Gmail senders as unavailable", async () => {
    seedCampaign({ senderProfile: { provider: "resend", oauthRefreshToken: null } });
    expect((await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" })).status).toBe(
      "sender_unavailable"
    );
  });

  it("returns a zero summary when no bounce messages exist", async () => {
    seedCampaign();
    seedJobs(50, "SENT");

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result).toEqual({
      status: "ok",
      summary: {
        checkedMessages: 0,
        bouncesFound: 0,
        invalidRecipientsUpdated: 0,
        suppressionsRecorded: 0,
        skippedAlreadyKnown: 0,
        gmailSyncSkipped: null
      }
    });
    // The sync ran forced and scoped to this campaign's sender; the
    // reclassification stayed scoped to this user's campaign.
    expect(calls.sync[0]).toMatchObject({ senderId: "sender-1", options: { force: true } });
    expect(calls.reclassify[0]).toMatchObject({ apply: true, userId: "user-1", campaignId: "campaign-1" });
  });

  it("counts recipients this check moved to the invalid/skipped outcome and removes them from delivered", async () => {
    seedCampaign();
    seedJobs(28, "SENT");
    seedJobs(22, "SENT", "campaign-1");
    // The sync heals 22 of this sequence's rows to the Skipped disposition.
    impl.sync = async () => {
      for (const job of state.jobs.slice(28)) {
        job.status = "SUPPRESSED";
        job.metadata = { failureCode: "HARD_BOUNCE_RECIPIENT" };
      }
      return { ...h.emptySyncResult(), checkedMessages: 40, bouncesParsed: 22, permanentFailures: 22 };
    };

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.summary.checkedMessages).toBe(40);
    expect(result.summary.bouncesFound).toBe(22);
    expect(result.summary.invalidRecipientsUpdated).toBe(22);
    expect(result.summary.suppressionsRecorded).toBe(22);
    expect(result.summary.skippedAlreadyKnown).toBe(0);
  });

  it("is idempotent — a second check reports zero new updates and remembers the known skipped", async () => {
    seedCampaign();
    seedJobs(28, "SENT");
    for (let index = 0; index < 22; index += 1) {
      state.jobs.push({ campaignId: "campaign-1", status: "SUPPRESSED", metadata: { failureCode: "HARD_BOUNCE_RECIPIENT" } });
    }

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.summary.invalidRecipientsUpdated).toBe(0);
    expect(result.summary.skippedAlreadyKnown).toBe(22);
  });

  it("also repairs rows from stored evidence when the DSN was already consumed by the idempotency gate", async () => {
    seedCampaign();
    seedJobs(49, "SENT");
    state.jobs.push({ campaignId: "campaign-1", status: "OPENED" });
    // Gmail sync finds nothing new (duplicate DSN), but the reclassification
    // converts the stuck row from its stored evidence.
    impl.reclassify = async () => {
      const stuck = state.jobs[state.jobs.length - 1];
      stuck.status = "SUPPRESSED";
      stuck.metadata = { failureCode: "HARD_BOUNCE_RECIPIENT" };
      return { scanned: 50, candidates: [{}], reclassifiedCount: 1, suppressionsRecordedCount: 1 };
    };

    const result = await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.summary.invalidRecipientsUpdated).toBe(1);
    expect(result.summary.suppressionsRecorded).toBe(1);
  });

  it("surfaces a stale Gmail authorization as disconnected when nothing could be repaired", async () => {
    seedCampaign();
    seedJobs(10, "SENT");
    impl.sync = async () => ({ ...h.emptySyncResult(), skipped: "reconnect_required" });

    expect((await checkSequenceBounces({ campaignId: "campaign-1", userId: "user-1" })).status).toBe(
      "sender_disconnected"
    );
  });
});
