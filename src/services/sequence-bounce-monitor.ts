// Automatic bounce monitoring for sequence runs. Every backend campaign tick
// (the cron route in production, the standalone scheduler locally) calls
// `runAutomaticSequenceBounceChecks` AFTER send work, so a running sequence
// gets its Gmail delivery-status notifications checked on a fixed cadence with
// no browser tab, page poll, or button click involved. It runs the exact same
// shared service as the manual "Check bounces" button (`checkSequenceBounces`):
// bounded Gmail DSN reads, stored-evidence reclassification, exact-email
// INVALID_EMAIL suppressions, and run rollup resyncs — one classifier, one
// suppression writer, one implementation. No email is ever sent from here.
//
// Cadence is enforced by a per-run checkpoint stored under the `bounceMonitor`
// key of `CampaignRun.progressSnapshot` (the same schema-free metadata slot
// the daily-limit pause info uses; every snapshot writer spread-merges, so the
// keys coexist). While a run is RUNNING a check fires at most once per
// interval; when it completes, one final check fires on the next tick and one
// delayed follow-up catches late-arriving bounces. After that the manual
// button owns the sequence. Selection is status/time-based only — no company,
// domain, sender, or recipient is ever special-cased.

import { Prisma } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { checkSequenceBounces } from "@/services/sequence-bounce-check";

/** While a run is RUNNING, check bounces at most once per this interval. */
export const ACTIVE_BOUNCE_CHECK_INTERVAL_MS = 5 * 60_000;
/** One delayed follow-up after completion — some Gmail bounces arrive late. */
export const COMPLETION_FOLLOW_UP_DELAY_MS = 10 * 60_000;
/** Immediate final check + one delayed follow-up, then automatic checks stop. */
export const MAX_COMPLETION_CHECKS = 2;
/** Runs completed longer ago than this are left to the manual button. */
export const COMPLETED_RUN_LOOKBACK_MS = 24 * 60 * 60_000;

// Per-tick bounds so bounce checks can never crowd out sending or blow the
// tick's time budget: a backlog simply drains over the next ticks.
const DEFAULT_MAX_CAMPAIGNS_PER_TICK = 3;
const DEFAULT_TICK_BUDGET_MS = 25_000;
const CANDIDATE_SCAN_LIMIT = 50;

const CHECKPOINT_KEY = "bounceMonitor";

export type BounceMonitorCheckpoint = {
  /** ISO timestamp of the last automatic check started for this run. */
  lastCheckAt: string | null;
  /** Safe outcome label of the last check ("ok", "sender_disconnected", …). */
  lastOutcome: string | null;
  /** Automatic checks started for this run (running + completion phases). */
  checksStarted: number;
  /** Post-completion checks consumed (bounded by MAX_COMPLETION_CHECKS). */
  completionChecksDone: number;
  /** Cumulative recipients this run's automatic checks moved to invalid/skipped. */
  invalidRecipientsUpdated: number;
};

export type BounceCheckPhase = "running" | "completion" | "completion-follow-up";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readBounceMonitorCheckpoint(progressSnapshot: unknown): BounceMonitorCheckpoint {
  const checkpoint = asRecord(asRecord(progressSnapshot)[CHECKPOINT_KEY]);
  return {
    lastCheckAt: typeof checkpoint.lastCheckAt === "string" ? checkpoint.lastCheckAt : null,
    lastOutcome: typeof checkpoint.lastOutcome === "string" ? checkpoint.lastOutcome : null,
    checksStarted: typeof checkpoint.checksStarted === "number" ? checkpoint.checksStarted : 0,
    completionChecksDone: typeof checkpoint.completionChecksDone === "number" ? checkpoint.completionChecksDone : 0,
    invalidRecipientsUpdated:
      typeof checkpoint.invalidRecipientsUpdated === "number" ? checkpoint.invalidRecipientsUpdated : 0
  };
}

type MonitorRunSnapshot = {
  status: string;
  completedAt: Date | null;
  progressSnapshot: unknown;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  invalidCount: number;
  openedCount: number;
  clickedCount: number;
};

/**
 * Decide whether an automatic bounce check is due for one run right now, and
 * in which phase. Pure so the cadence rules are directly unit-testable.
 */
export function getDueBounceCheckPhase(run: MonitorRunSnapshot, now = new Date()): BounceCheckPhase | null {
  const checkpoint = readBounceMonitorCheckpoint(run.progressSnapshot);
  const lastCheckMs = checkpoint.lastCheckAt ? Date.parse(checkpoint.lastCheckAt) : null;

  if (run.status === "RUNNING") {
    // Nothing dispatched yet — there is nothing that can have bounced.
    const dispatched =
      run.sentCount + run.failedCount + run.suppressedCount + run.invalidCount + run.openedCount + run.clickedCount;
    if (dispatched <= 0) {
      return null;
    }
    if (lastCheckMs === null || now.getTime() - lastCheckMs >= ACTIVE_BOUNCE_CHECK_INTERVAL_MS) {
      return "running";
    }
    return null;
  }

  if (run.status === "COMPLETED" && run.completedAt) {
    if (now.getTime() - run.completedAt.getTime() > COMPLETED_RUN_LOOKBACK_MS) {
      return null;
    }
    if (checkpoint.completionChecksDone >= MAX_COMPLETION_CHECKS) {
      return null;
    }
    if (checkpoint.completionChecksDone === 0) {
      // The transition to Completed gets its final check on the next tick,
      // even when a running-phase check happened moments earlier.
      return "completion";
    }
    // Exactly one delayed follow-up, spaced from both the completion moment
    // and the previous check so back-to-back ticks never double-scan.
    const dueAt = Math.max(
      run.completedAt.getTime() + COMPLETION_FOLLOW_UP_DELAY_MS,
      (lastCheckMs ?? 0) + ACTIVE_BOUNCE_CHECK_INTERVAL_MS
    );
    return now.getTime() >= dueAt ? "completion-follow-up" : null;
  }

  return null;
}

/**
 * Re-read one run and, if a check is still due, advance its checkpoint before
 * any Gmail work happens. Claiming first keeps overlapping ticks from starting
 * duplicate scans (the bounce pipeline's Redis locks and idempotency gates
 * make a rare double-claim harmless), and guarantees a crashed check consumes
 * its cadence slot instead of retrying in a hot loop.
 */
async function claimDueBounceCheck(runId: string, now: Date): Promise<BounceCheckPhase | null> {
  const run = await prisma.campaignRun.findUnique({
    where: { id: runId },
    select: {
      status: true,
      completedAt: true,
      progressSnapshot: true,
      sentCount: true,
      failedCount: true,
      suppressedCount: true,
      invalidCount: true,
      openedCount: true,
      clickedCount: true
    }
  });
  if (!run) {
    return null;
  }
  const phase = getDueBounceCheckPhase(run, now);
  if (!phase) {
    return null;
  }

  const snapshot = asRecord(run.progressSnapshot);
  const checkpoint = readBounceMonitorCheckpoint(run.progressSnapshot);
  const claimed: BounceMonitorCheckpoint = {
    ...checkpoint,
    lastCheckAt: now.toISOString(),
    checksStarted: checkpoint.checksStarted + 1,
    completionChecksDone: phase === "running" ? checkpoint.completionChecksDone : checkpoint.completionChecksDone + 1
  };
  await prisma.campaignRun.update({
    where: { id: runId },
    data: { progressSnapshot: { ...snapshot, [CHECKPOINT_KEY]: claimed } as Prisma.InputJsonValue }
  });
  return phase;
}

/** Merge the check's safe outcome back into the run's checkpoint. */
async function recordBounceCheckOutcome(runId: string, outcome: string, invalidRecipientsUpdated: number) {
  const run = await prisma.campaignRun.findUnique({
    where: { id: runId },
    select: { progressSnapshot: true }
  });
  if (!run) {
    return;
  }
  const snapshot = asRecord(run.progressSnapshot);
  const checkpoint = readBounceMonitorCheckpoint(run.progressSnapshot);
  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      progressSnapshot: {
        ...snapshot,
        [CHECKPOINT_KEY]: {
          ...checkpoint,
          lastOutcome: outcome,
          invalidRecipientsUpdated: checkpoint.invalidRecipientsUpdated + invalidRecipientsUpdated
        }
      } as Prisma.InputJsonValue
    }
  });
}

export type AutomaticBounceCheckResult = {
  /** Candidate runs (running or recently completed) inspected this tick. */
  runsConsidered: number;
  /** Sequences actually checked this tick. */
  checksStarted: number;
  /** Candidate runs whose cadence window had not elapsed yet. */
  skippedByCadence: number;
  /** Due sequences left for the next tick (per-tick cap or time budget hit). */
  deferred: number;
  /** Recipients moved to the invalid/skipped outcome across all checks. */
  invalidRecipientsUpdated: number;
  /** Exact-email suppression writes performed across all checks. */
  suppressionsCreated: number;
  /** Missing Gmail entities (404 messages/threads) skipped safely. */
  gmailMissingEntitiesSkipped: number;
  /** Checks that ended in a non-ok state (Gmail outage, stale authorization, …). */
  checkFailures: number;
};

function emptyResult(): AutomaticBounceCheckResult {
  return {
    runsConsidered: 0,
    checksStarted: 0,
    skippedByCadence: 0,
    deferred: 0,
    invalidRecipientsUpdated: 0,
    suppressionsCreated: 0,
    gmailMissingEntitiesSkipped: 0,
    checkFailures: 0
  };
}

/**
 * One monitoring pass: find sequences with a RUNNING or recently-COMPLETED
 * run on a connected Gmail sender, and run the shared bounce check for each
 * one whose cadence is due. Every failure mode is contained per sequence — a
 * Gmail outage, revoked authorization, or unexpected error is recorded on the
 * run's checkpoint and never propagates to the caller, so campaign processing
 * is never blocked by bounce monitoring.
 */
export async function runAutomaticSequenceBounceChecks(
  options: { now?: Date; maxCampaigns?: number; timeBudgetMs?: number } = {}
): Promise<AutomaticBounceCheckResult> {
  const now = options.now ?? new Date();
  const tickStartedAt = Date.now();
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TICK_BUDGET_MS;
  const maxCampaigns = options.maxCampaigns ?? DEFAULT_MAX_CAMPAIGNS_PER_TICK;
  const result = emptyResult();

  const candidates = await prisma.campaignRun.findMany({
    where: {
      campaign: {
        userId: { not: null },
        senderProfile: { provider: "google_oauth", oauthRefreshToken: { not: null } }
      },
      OR: [
        { status: "RUNNING" },
        { status: "COMPLETED", completedAt: { gte: new Date(now.getTime() - COMPLETED_RUN_LOOKBACK_MS) } }
      ]
    },
    select: {
      id: true,
      campaignId: true,
      status: true,
      completedAt: true,
      progressSnapshot: true,
      sentCount: true,
      failedCount: true,
      suppressedCount: true,
      invalidCount: true,
      openedCount: true,
      clickedCount: true,
      campaign: {
        select: {
          userId: true,
          name: true,
          user: { select: { email: true } }
        }
      }
    },
    // Least recently touched first: a run bumps updatedAt whenever it advances
    // (sends, rollup resyncs, checkpoint writes), so attention rotates fairly
    // across sequences without any extra bookkeeping.
    orderBy: [{ updatedAt: "asc" }],
    take: CANDIDATE_SCAN_LIMIT
  });
  result.runsConsidered = candidates.length;

  // One bounce check covers a whole sequence, so group the candidate runs by
  // campaign and claim every due run of that campaign around a single check.
  const runsByCampaign = new Map<string, typeof candidates>();
  for (const run of candidates) {
    const group = runsByCampaign.get(run.campaignId);
    if (group) {
      group.push(run);
    } else {
      runsByCampaign.set(run.campaignId, [run]);
    }
  }

  for (const [campaignId, runs] of runsByCampaign) {
    const userId = runs[0].campaign.userId;
    if (!userId) {
      continue;
    }
    const dueRuns = runs.filter((run) => getDueBounceCheckPhase(run, now) !== null);
    if (dueRuns.length === 0) {
      result.skippedByCadence += runs.length;
      continue;
    }
    if (result.checksStarted >= maxCampaigns || Date.now() - tickStartedAt >= timeBudgetMs) {
      result.deferred += 1;
      continue;
    }

    // Claim before checking (a fresh read guards against races with the send
    // loop between the candidate query and now).
    const claims: Array<{ runId: string; phase: BounceCheckPhase }> = [];
    for (const run of dueRuns) {
      const phase = await claimDueBounceCheck(run.id, now);
      if (phase) {
        claims.push({ runId: run.id, phase });
      }
    }
    if (claims.length === 0) {
      result.skippedByCadence += runs.length;
      continue;
    }

    result.checksStarted += 1;
    const phases = claims.map((claim) => claim.phase);
    // Safe operational logs only — ids, phases, and counts; never a recipient
    // address, Gmail message content, or OAuth material.
    console.log("[bounce-monitor] Automatic bounce check started.", { campaignId, phases });

    try {
      const check = await checkSequenceBounces({ campaignId, userId });

      if (check.status === "ok") {
        result.invalidRecipientsUpdated += check.summary.invalidRecipientsUpdated;
        result.suppressionsCreated += check.summary.suppressionsCreated;
        result.gmailMissingEntitiesSkipped += check.summary.skippedMissingGmailEntities;
        for (const claim of claims) {
          await recordBounceCheckOutcome(claim.runId, "ok", check.summary.invalidRecipientsUpdated);
        }
        console.log("[bounce-monitor] Automatic bounce check finished.", {
          campaignId,
          phases,
          invalidRecipientsUpdated: check.summary.invalidRecipientsUpdated,
          gmailMessagesChecked: check.summary.gmailMessagesChecked,
          skippedMissingGmailEntities: check.summary.skippedMissingGmailEntities
        });

        // Quiet by design: no toast, no notification — just the audit trail,
        // and only when the check actually changed recipient outcomes.
        const updated = check.summary.invalidRecipientsUpdated;
        if (updated > 0 && runs[0].campaign.user?.email) {
          await recordAuditEvent({
            actor: { id: userId, email: runs[0].campaign.user.email },
            action: "sequence.bounce_check",
            category: "SEQUENCE",
            target: { type: "sequence", id: campaignId, name: runs[0].campaign.name },
            message: `Automatic bounce monitoring marked ${updated} invalid recipient${updated === 1 ? "" : "s"} as skipped.`,
            metadata: { trigger: "automatic", phases, ...check.summary }
          });
        }
      } else {
        // A safe terminal state from the shared service: stale authorization,
        // non-Gmail sender, or a transient Gmail outage that repaired nothing.
        // Record it and let the next due tick (or the manual button) retry —
        // recipients are never marked failed because monitoring couldn't read
        // the mailbox.
        if (check.status === "gmail_unavailable" || check.status === "sender_disconnected") {
          result.checkFailures += 1;
        }
        for (const claim of claims) {
          await recordBounceCheckOutcome(claim.runId, check.status, 0);
        }
        console.warn("[bounce-monitor] Automatic bounce check could not read Gmail.", {
          campaignId,
          phases,
          status: check.status
        });
      }
    } catch (error) {
      // Never let one sequence's failure stop monitoring for the others (or
      // bubble into campaign processing).
      result.checkFailures += 1;
      for (const claim of claims) {
        await recordBounceCheckOutcome(claim.runId, "error", 0).catch(() => undefined);
      }
      console.warn("[bounce-monitor] Automatic bounce check failed; continuing.", {
        campaignId,
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown"
      });
    }
  }

  if (result.checksStarted > 0 || result.checkFailures > 0 || result.deferred > 0) {
    console.log("[bounce-monitor] Tick summary.", result);
  }
  return result;
}
