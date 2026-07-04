import { Prisma, type RunStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  SEQUENCE_CONCURRENCY_LIMIT_CODE,
  SEQUENCE_CONCURRENCY_LIMIT_MESSAGE,
  SEQUENCE_STORAGE_LIMIT_CODE,
  SEQUENCE_STORAGE_LIMIT_MESSAGE
} from "@/lib/sequence-limit-codes";
import { getSequenceEntitlements } from "@/lib/sequence-entitlements";

type TransactionClient = Prisma.TransactionClient;

/**
 * A run consumes a sequence execution slot only while it is queued for the
 * immediate send pipeline or actively running, and only while it owns a durable
 * claim. Future scheduled QUEUED runs have no claim and consume no slot.
 */
export const EXECUTION_SLOT_RUN_STATUSES = ["QUEUED", "RUNNING"] as const satisfies ReadonlyArray<RunStatus>;

const executionSlotRunStatuses = new Set<RunStatus>(EXECUTION_SLOT_RUN_STATUSES);
const RECONCILIATION_BATCH_SIZE = 100;

export function isSequenceConsumingExecutionSlot(run: {
  status: RunStatus | string;
  executionSlotClaimedAt?: Date | string | null;
}): boolean {
  return executionSlotRunStatuses.has(run.status as RunStatus) && Boolean(run.executionSlotClaimedAt);
}

export class SequenceStorageLimitError extends Error {
  readonly code = SEQUENCE_STORAGE_LIMIT_CODE;

  constructor() {
    super(SEQUENCE_STORAGE_LIMIT_MESSAGE);
    this.name = "SequenceStorageLimitError";
  }
}

export class SequenceConcurrencyLimitError extends Error {
  readonly code = SEQUENCE_CONCURRENCY_LIMIT_CODE;

  constructor(readonly activeCount: number) {
    super(SEQUENCE_CONCURRENCY_LIMIT_MESSAGE);
    this.name = "SequenceConcurrencyLimitError";
  }
}

/** Serialize every capacity-changing operation for one authenticated user. */
export async function lockSequenceUser(tx: TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sendloom:sequence-slots:${userId}`}, 0))`;
}

async function getTrustedEntitlements(tx: TransactionClient, userId: string) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true }
  });
  return getSequenceEntitlements(user);
}

export async function withSequenceUserLock<T>(
  userId: string,
  operation: (tx: TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {}
) {
  return prisma.$transaction(
    async (tx) => {
      await lockSequenceUser(tx, userId);
      return operation(tx);
    },
    { timeout: options.timeoutMs ?? 15_000 }
  );
}

/**
 * Atomically enforce the retained-sequence ceiling and perform the create in
 * the same per-user critical section. The operation is not invoked at the
 * limit, allowing routes to defer attachment uploads until after this gate.
 */
export async function withSequenceCreationCapacity<T>(
  userId: string,
  operation: (tx: TransactionClient) => Promise<T>
) {
  return withSequenceUserLock(
    userId,
    async (tx) => {
      const entitlements = await getTrustedEntitlements(tx, userId);
      if (entitlements.maxStoredSequences !== null) {
        const storedCount = await tx.campaign.count({ where: { userId } });
        if (storedCount >= entitlements.maxStoredSequences) {
          throw new SequenceStorageLimitError();
        }
      }

      return operation(tx);
    },
    { timeoutMs: 60_000 }
  );
}

export async function getSequenceExecutionCapacity(tx: TransactionClient, userId: string) {
  const entitlements = await getTrustedEntitlements(tx, userId);
  const activeCount = await tx.campaignRun.count({
    where: {
      campaign: { userId },
      status: { in: [...EXECUTION_SLOT_RUN_STATUSES] },
      executionSlotClaimedAt: { not: null }
    }
  });

  return {
    activeCount,
    available:
      entitlements.maxConcurrentSequences === null
        ? null
        : Math.max(0, entitlements.maxConcurrentSequences - activeCount),
    limit: entitlements.maxConcurrentSequences
  };
}

/** Must run inside a transaction holding lockSequenceUser for this user. */
export async function claimSequenceExecutionSlot(
  tx: TransactionClient,
  args: { userId: string; runId: string; now?: Date }
) {
  const now = args.now ?? new Date();
  const existing = await tx.campaignRun.findFirst({
    where: { id: args.runId, campaign: { userId: args.userId } },
    select: { executionSlotClaimedAt: true, status: true }
  });

  if (!existing) {
    throw new Error("Sequence run not found.");
  }

  if (existing.executionSlotClaimedAt && executionSlotRunStatuses.has(existing.status)) {
    const capacity = await getSequenceExecutionCapacity(tx, args.userId);
    return { acquired: true as const, activeCount: capacity.activeCount };
  }

  const capacity = await getSequenceExecutionCapacity(tx, args.userId);
  if (capacity.available !== null && capacity.available <= 0) {
    return { acquired: false as const, activeCount: capacity.activeCount };
  }

  await tx.campaignRun.update({
    where: { id: args.runId },
    data: {
      status: "QUEUED",
      executionSlotClaimedAt: now,
      waitingForSlotAt: null
    }
  });

  return { acquired: true as const, activeCount: capacity.activeCount + 1 };
}

async function claimDueRunOrWait(runId: string, userId: string, now: Date) {
  return withSequenceUserLock(userId, async (tx) => {
    const run = await tx.campaignRun.findFirst({
      where: {
        id: runId,
        campaign: { userId },
        status: { in: ["QUEUED", "RUNNING"] },
        executionSlotClaimedAt: null,
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }]
      },
      select: { id: true, campaignId: true, scheduledFor: true }
    });

    if (!run) {
      return "skipped" as const;
    }

    const claim = await claimSequenceExecutionSlot(tx, { userId, runId, now });
    if (claim.acquired) {
      await tx.campaign.update({ where: { id: run.campaignId }, data: { status: "RUNNING" } });
      return "claimed" as const;
    }

    await tx.campaignRun.update({
      where: { id: run.id },
      data: {
        status: "WAITING_FOR_SLOT",
        waitingForSlotAt: run.scheduledFor ?? now,
        executionSlotClaimedAt: null
      }
    });
    await tx.campaign.update({ where: { id: run.campaignId }, data: { status: "WAITING_FOR_SLOT" } });
    return "waiting" as const;
  });
}

/** Move due scheduled runs into a claimed slot or the durable waiting queue. */
export async function acquireDueSequenceExecutionSlots(now = new Date(), batchSize = RECONCILIATION_BATCH_SIZE) {
  const dueRuns = await prisma.campaignRun.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      executionSlotClaimedAt: null,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      campaign: { userId: { not: null } }
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, campaign: { select: { userId: true } } }
  });

  let claimed = 0;
  let waiting = 0;
  for (const run of dueRuns) {
    if (!run.campaign.userId) continue;
    const result = await claimDueRunOrWait(run.id, run.campaign.userId, now);
    if (result === "claimed") claimed += 1;
    if (result === "waiting") waiting += 1;
  }

  return { scanned: dueRuns.length, claimed, waiting };
}

/** Promote one user's queue FIFO while holding the same lock used by launches. */
export async function promoteWaitingSequencesForUser(userId: string, now = new Date()) {
  return withSequenceUserLock(userId, async (tx) => {
    const capacity = await getSequenceExecutionCapacity(tx, userId);
    let available = capacity.available;

    const waitingRuns = await tx.campaignRun.findMany({
      where: { status: "WAITING_FOR_SLOT", campaign: { userId } },
      orderBy: [{ waitingForSlotAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      select: {
        id: true,
        campaignId: true,
        campaign: {
          select: {
            status: true,
            userId: true,
            import: { select: { status: true } },
            senderProfile: { select: { oauthRefreshToken: true } }
          }
        }
      }
    });

    const promotedRunIds: string[] = [];
    for (const run of waitingRuns) {
      const eligible =
        run.campaign.userId === userId &&
        run.campaign.status === "WAITING_FOR_SLOT" &&
        run.campaign.import.status === "PROCESSED" &&
        Boolean(run.campaign.senderProfile.oauthRefreshToken);

      if (!eligible) {
        await tx.campaignRun.update({
          where: { id: run.id },
          data: {
            status: "CANCELLED",
            waitingForSlotAt: null,
            executionSlotClaimedAt: null,
            completedAt: now
          }
        });
        await tx.campaign.update({ where: { id: run.campaignId }, data: { status: "VALIDATED" } });
        continue;
      }

      if (available !== null && available <= 0) {
        break;
      }

      await tx.campaignRun.update({
        where: { id: run.id },
        data: {
          status: "QUEUED",
          waitingForSlotAt: null,
          executionSlotClaimedAt: now,
          scheduledFor: now
        }
      });
      await tx.campaign.update({ where: { id: run.campaignId }, data: { status: "RUNNING" } });
      promotedRunIds.push(run.id);
      if (available !== null) available -= 1;
    }

    return { promotedRunIds };
  });
}

/** Lightweight, batched queue reconciliation for the existing cron tick. */
export async function reconcileWaitingSequenceSlots(batchSize = RECONCILIATION_BATCH_SIZE) {
  const waiting = await prisma.campaignRun.findMany({
    where: { status: "WAITING_FOR_SLOT", campaign: { userId: { not: null } } },
    orderBy: [{ waitingForSlotAt: "asc" }, { id: "asc" }],
    take: Math.max(batchSize, 1) * 4,
    select: { campaign: { select: { userId: true } } }
  });
  const userIds = Array.from(new Set(waiting.map((entry) => entry.campaign.userId).filter(Boolean))).slice(
    0,
    batchSize
  ) as string[];

  const promotedRunIds: string[] = [];
  for (const userId of userIds) {
    const result = await promoteWaitingSequencesForUser(userId);
    promotedRunIds.push(...result.promotedRunIds);
  }

  return { usersScanned: userIds.length, promotedRunIds };
}

/** Final worker guard: only a claimed queued/running run may enter sending. */
export async function activateClaimedSequenceRun(runId: string) {
  const updated = await prisma.campaignRun.updateMany({
    where: {
      id: runId,
      status: { in: [...EXECUTION_SLOT_RUN_STATUSES] },
      executionSlotClaimedAt: { not: null }
    },
    data: { status: "RUNNING", startedAt: new Date() }
  });
  return updated.count === 1;
}
