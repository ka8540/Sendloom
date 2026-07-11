import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory CampaignRun state; the shared sequence bounce check is mocked with
// a swappable behavior so each test controls what a check "finds". No real
// Gmail, redis, or database is touched, and nothing here can send an email —
// the monitor only ever calls the shared read-and-classify service.
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    runs: [] as Row[]
  };
  const calls = {
    check: [] as Row[],
    audit: [] as Row[]
  };
  const emptySummary = () => ({
    gmailMessagesChecked: 0,
    bouncesFound: 0,
    existingRowsReclassified: 0,
    invalidRecipientsUpdated: 0,
    suppressionsCreated: 0,
    statsChanged: false,
    skippedAlreadyKnown: 0,
    gmailSyncSkipped: null,
    missingMessageCount: 0,
    missingThreadCount: 0,
    skippedMissingGmailEntities: 0
  });
  const impl = {
    check: (async () => ({ status: "ok", summary: emptySummary() })) as (args: Row) => Promise<Row>
  };
  const prismaMock = {
    campaignRun: {
      findMany: async ({ where, take }: Row) => {
        const clauses = (where.OR ?? []) as Row[];
        return state.runs
          .filter((run) => {
            if (!run.campaign.userId) return false;
            if (run.campaign.senderProfile?.provider !== "google_oauth") return false;
            if (!run.campaign.senderProfile?.oauthRefreshToken) return false;
            return clauses.some((clause) =>
              clause.status === "RUNNING"
                ? run.status === "RUNNING"
                : run.status === "COMPLETED" && run.completedAt && run.completedAt >= clause.completedAt.gte
            );
          })
          .slice(0, take ?? Infinity);
      },
      findUnique: async ({ where }: Row) => state.runs.find((run) => run.id === where.id) ?? null,
      update: async ({ where, data }: Row) => {
        const run = state.runs.find((row) => row.id === where.id);
        if (!run) throw new Error("Run not found");
        Object.assign(run, data);
        return run;
      }
    }
  };
  return { state, calls, impl, prismaMock, emptySummary };
});

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: async (event: Record<string, unknown>) => {
    h.calls.audit.push(event);
  }
}));
vi.mock("@/services/sequence-bounce-check", () => ({
  checkSequenceBounces: (args: Record<string, unknown>) => {
    h.calls.check.push(args);
    return h.impl.check(args);
  }
}));

import {
  ACTIVE_BOUNCE_CHECK_INTERVAL_MS,
  COMPLETED_RUN_LOOKBACK_MS,
  COMPLETION_FOLLOW_UP_DELAY_MS,
  getDueBounceCheckPhase,
  readBounceMonitorCheckpoint,
  runAutomaticSequenceBounceChecks
} from "@/services/sequence-bounce-monitor";

const { state, calls, impl } = h;

const NOW = new Date("2026-07-11T18:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(NOW.getTime() - minutes * 60_000);
}

let runCounter = 0;

function seedRun(overrides: Record<string, any> = {}) {
  runCounter += 1;
  const run = {
    id: `run-${runCounter}`,
    campaignId: "campaign-1",
    status: "RUNNING",
    completedAt: null,
    progressSnapshot: null,
    sentCount: 10,
    failedCount: 0,
    suppressedCount: 0,
    invalidCount: 0,
    openedCount: 0,
    clickedCount: 0,
    campaign: {
      userId: "user-1",
      name: "Outreach sequence",
      user: { email: "owner@example.com" },
      senderProfile: { provider: "google_oauth", oauthRefreshToken: "refresh-1" }
    },
    ...overrides
  };
  state.runs.push(run);
  return run;
}

function checkpointSnapshot(checkpoint: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { ...extra, bounceMonitor: checkpoint };
}

beforeEach(() => {
  state.runs.length = 0;
  calls.check.length = 0;
  calls.audit.length = 0;
  runCounter = 0;
  impl.check = async () => ({ status: "ok", summary: h.emptySummary() });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("getDueBounceCheckPhase cadence rules", () => {
  it("is due immediately for a running run that has dispatched sends and was never checked", () => {
    const run = seedRun();
    expect(getDueBounceCheckPhase(run, NOW)).toBe("running");
  });

  it("is not due for a running run that has not dispatched anything yet", () => {
    const run = seedRun({ sentCount: 0 });
    expect(getDueBounceCheckPhase(run, NOW)).toBeNull();
  });

  it("respects the running cadence window — no second check before it elapses", () => {
    const run = seedRun({
      progressSnapshot: checkpointSnapshot({ lastCheckAt: minutesAgo(2).toISOString() })
    });
    expect(getDueBounceCheckPhase(run, NOW)).toBeNull();
  });

  it("is due again once the running cadence window has elapsed", () => {
    const run = seedRun({
      progressSnapshot: checkpointSnapshot({ lastCheckAt: minutesAgo(6).toISOString() })
    });
    expect(ACTIVE_BOUNCE_CHECK_INTERVAL_MS).toBe(5 * 60_000);
    expect(getDueBounceCheckPhase(run, NOW)).toBe("running");
  });

  it("runs a final check immediately when the run transitions to Completed, even after a recent running check", () => {
    const run = seedRun({
      status: "COMPLETED",
      completedAt: minutesAgo(1),
      progressSnapshot: checkpointSnapshot({ lastCheckAt: minutesAgo(1).toISOString() })
    });
    expect(getDueBounceCheckPhase(run, NOW)).toBe("completion");
  });

  it("schedules exactly one delayed follow-up after the completion check", () => {
    const beforeDelay = seedRun({
      status: "COMPLETED",
      completedAt: minutesAgo(5),
      progressSnapshot: checkpointSnapshot({ completionChecksDone: 1, lastCheckAt: minutesAgo(5).toISOString() })
    });
    expect(getDueBounceCheckPhase(beforeDelay, NOW)).toBeNull();

    const afterDelay = seedRun({
      status: "COMPLETED",
      completedAt: minutesAgo(15),
      progressSnapshot: checkpointSnapshot({ completionChecksDone: 1, lastCheckAt: minutesAgo(15).toISOString() })
    });
    expect(COMPLETION_FOLLOW_UP_DELAY_MS).toBe(10 * 60_000);
    expect(getDueBounceCheckPhase(afterDelay, NOW)).toBe("completion-follow-up");

    const exhausted = seedRun({
      status: "COMPLETED",
      completedAt: minutesAgo(20),
      progressSnapshot: checkpointSnapshot({ completionChecksDone: 2, lastCheckAt: minutesAgo(9).toISOString() })
    });
    expect(getDueBounceCheckPhase(exhausted, NOW)).toBeNull();
  });

  it("leaves old completed runs to the manual button", () => {
    const run = seedRun({
      status: "COMPLETED",
      completedAt: new Date(NOW.getTime() - COMPLETED_RUN_LOOKBACK_MS - 60_000)
    });
    expect(getDueBounceCheckPhase(run, NOW)).toBeNull();
  });

  it("never triggers for paused or queued runs", () => {
    expect(getDueBounceCheckPhase(seedRun({ status: "PAUSED" }), NOW)).toBeNull();
    expect(getDueBounceCheckPhase(seedRun({ status: "QUEUED" }), NOW)).toBeNull();
  });
});

describe("runAutomaticSequenceBounceChecks", () => {
  it("checks a due running sequence through the same shared service as the manual button", async () => {
    seedRun();

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.checksStarted).toBe(1);
    // Exact same service + arguments the manual sync-bounces route uses.
    expect(calls.check).toEqual([{ campaignId: "campaign-1", userId: "user-1" }]);
    // The checkpoint advanced so the next tick is cadence-gated.
    const checkpoint = readBounceMonitorCheckpoint(state.runs[0].progressSnapshot);
    expect(checkpoint.lastCheckAt).toBe(NOW.toISOString());
    expect(checkpoint.checksStarted).toBe(1);
    expect(checkpoint.lastOutcome).toBe("ok");
  });

  it("skips the sequence when the cadence window has not elapsed — no Gmail work on every tick", async () => {
    seedRun({ progressSnapshot: checkpointSnapshot({ lastCheckAt: minutesAgo(2).toISOString() }) });

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.checksStarted).toBe(0);
    expect(result.skippedByCadence).toBe(1);
    expect(calls.check).toHaveLength(0);
  });

  it("aggregates invalid-recipient and suppression counts from the shared check", async () => {
    seedRun();
    impl.check = async () => ({
      status: "ok",
      summary: {
        ...h.emptySummary(),
        invalidRecipientsUpdated: 22,
        suppressionsCreated: 22,
        skippedMissingGmailEntities: 3,
        statsChanged: true
      }
    });

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.invalidRecipientsUpdated).toBe(22);
    expect(result.suppressionsCreated).toBe(22);
    expect(result.gmailMissingEntitiesSkipped).toBe(3);
    expect(readBounceMonitorCheckpoint(state.runs[0].progressSnapshot).invalidRecipientsUpdated).toBe(22);
  });

  it("records an audit event only when recipients actually changed — quiet otherwise", async () => {
    seedRun();
    await runAutomaticSequenceBounceChecks({ now: NOW });
    expect(calls.audit).toHaveLength(0);

    state.runs[0].progressSnapshot = null; // make it due again
    impl.check = async () => ({
      status: "ok",
      summary: { ...h.emptySummary(), invalidRecipientsUpdated: 2, suppressionsCreated: 2, statsChanged: true }
    });
    await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0]).toMatchObject({
      action: "sequence.bounce_check",
      metadata: expect.objectContaining({ trigger: "automatic" })
    });
  });

  it("counts a completion check and its follow-up, then stops automatically", async () => {
    const run = seedRun({ status: "COMPLETED", completedAt: minutesAgo(1) });

    // Tick 1: immediate final check on completion.
    await runAutomaticSequenceBounceChecks({ now: NOW });
    expect(calls.check).toHaveLength(1);
    expect(readBounceMonitorCheckpoint(run.progressSnapshot).completionChecksDone).toBe(1);

    // Tick 2 (one minute later): follow-up not due yet.
    await runAutomaticSequenceBounceChecks({ now: new Date(NOW.getTime() + 60_000) });
    expect(calls.check).toHaveLength(1);

    // Tick 3 (after the follow-up delay): the single delayed follow-up runs.
    await runAutomaticSequenceBounceChecks({ now: new Date(NOW.getTime() + 12 * 60_000) });
    expect(calls.check).toHaveLength(2);
    expect(readBounceMonitorCheckpoint(run.progressSnapshot).completionChecksDone).toBe(2);

    // Tick 4: automatic monitoring is done; only the manual button remains.
    await runAutomaticSequenceBounceChecks({ now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(calls.check).toHaveLength(2);
  });

  it("checks each campaign once even when several of its runs are due", async () => {
    seedRun({ status: "COMPLETED", completedAt: minutesAgo(2) });
    seedRun(); // second run of the same campaign, currently sending

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.checksStarted).toBe(1);
    expect(calls.check).toHaveLength(1);
    // Both runs' checkpoints advanced around the single shared check.
    expect(readBounceMonitorCheckpoint(state.runs[0].progressSnapshot).lastCheckAt).toBe(NOW.toISOString());
    expect(readBounceMonitorCheckpoint(state.runs[1].progressSnapshot).lastCheckAt).toBe(NOW.toISOString());
  });

  it("bounds work per tick and defers the rest to the next tick", async () => {
    seedRun({ campaignId: "campaign-1" });
    seedRun({ campaignId: "campaign-2" });
    seedRun({ campaignId: "campaign-3" });

    const result = await runAutomaticSequenceBounceChecks({ now: NOW, maxCampaigns: 2 });

    expect(result.checksStarted).toBe(2);
    expect(result.deferred).toBe(1);
    expect(calls.check).toHaveLength(2);
  });

  it("records a safe disconnected outcome without crashing when Gmail authorization is stale", async () => {
    seedRun();
    impl.check = async () => ({ status: "sender_disconnected" });

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.checkFailures).toBe(1);
    expect(readBounceMonitorCheckpoint(state.runs[0].progressSnapshot).lastOutcome).toBe("sender_disconnected");
    // The cadence checkpoint still advanced — no reconnect retry storm.
    expect(readBounceMonitorCheckpoint(state.runs[0].progressSnapshot).lastCheckAt).toBe(NOW.toISOString());
  });

  it("contains one sequence's unexpected failure and keeps checking the others", async () => {
    seedRun({ campaignId: "campaign-1" });
    seedRun({ campaignId: "campaign-2" });
    impl.check = async (args) => {
      if (args.campaignId === "campaign-1") {
        throw new Error("Gmail backend error (500).");
      }
      return { status: "ok", summary: h.emptySummary() };
    };

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.checksStarted).toBe(2);
    expect(result.checkFailures).toBe(1);
    expect(calls.check).toHaveLength(2);
    expect(readBounceMonitorCheckpoint(state.runs[0].progressSnapshot).lastOutcome).toBe("error");
    expect(readBounceMonitorCheckpoint(state.runs[1].progressSnapshot).lastOutcome).toBe("ok");
  });

  it("ignores sequences whose sender is not a connected Gmail account", async () => {
    seedRun({
      campaign: {
        userId: "user-1",
        name: "Resend sequence",
        user: { email: "owner@example.com" },
        senderProfile: { provider: "resend", oauthRefreshToken: null }
      }
    });

    const result = await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(result.runsConsidered).toBe(0);
    expect(calls.check).toHaveLength(0);
  });

  it("preserves unrelated progressSnapshot keys (daily-limit pause info) when writing the checkpoint", async () => {
    seedRun({
      progressSnapshot: { pauseReason: "DAILY_SEND_LIMIT", pauseMessage: "Daily limit reached." }
    });

    await runAutomaticSequenceBounceChecks({ now: NOW });

    expect(state.runs[0].progressSnapshot).toMatchObject({
      pauseReason: "DAILY_SEND_LIMIT",
      pauseMessage: "Daily limit reached.",
      bounceMonitor: expect.objectContaining({ lastCheckAt: NOW.toISOString() })
    });
  });

  it("never sends email and never depends on a browser: the module only reads runs and calls the shared check", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/services/sequence-bounce-monitor.ts", "utf8");

    // Server-side only — no client hooks, timers, or UI wiring.
    expect(source).not.toMatch(/use client|setInterval|window\.|document\./);
    // Never touches the send pipeline.
    expect(source).not.toMatch(/sendEmail|processRecipientJob|processCampaignRun|reserveSendCapacity/);
    // No company-, domain-, or recipient-specific special cases.
    expect(source).not.toMatch(/intuit|blackrock|@[a-z0-9-]+\.(com|net|org)\b/i);
  });
});
