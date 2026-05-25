import type { RecipientJobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { isMissingSendLedgerTableError, warnMissingSendLedgerTable } from "@/lib/send-ledger-table";

export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESERVATION_PREFIX = "gmail-daily-send-window";
const SUCCESSFUL_RECIPIENT_STATUSES: RecipientJobStatus[] = ["SENT", "OPENED", "CLICKED"];

export type DailySendLimitScope = {
  userId?: string | null;
  senderProfileId?: string | null;
};

export type DailySendWindow = {
  limit: number;
  sentLast24h: number;
  remaining: number;
  isBlocked: boolean;
  ledgerAvailable: boolean;
  resetAt: string | null;
  oldestCountedSendAt: string | null;
  windowStart: string;
  windowEnd: string;
};

export type ReservationResult =
  | {
      allowed: true;
      reservationId: string;
      remaining: number;
    }
  | {
      allowed: false;
      window: DailySendWindow;
    };

export function getDailySendLimit() {
  return env.GMAIL_DAILY_SEND_SAFETY_LIMIT;
}

function getScopeKey(scope: DailySendLimitScope) {
  if (scope.senderProfileId) {
    return `sender:${scope.senderProfileId}`;
  }
  if (scope.userId) {
    return `user:${scope.userId}`;
  }
  return "global";
}

function getReservationRedisKey(scope: DailySendLimitScope) {
  return `${RESERVATION_PREFIX}:${getScopeKey(scope)}`;
}

function isScopeAddressable(scope: DailySendLimitScope) {
  return Boolean(scope.senderProfileId || scope.userId);
}

function buildWhere(scope: DailySendLimitScope, since: Date) {
  if (scope.senderProfileId) {
    return {
      senderProfileId: scope.senderProfileId,
      sentAt: { gte: since }
    };
  }
  return {
    userId: scope.userId ?? undefined,
    sentAt: { gte: since }
  };
}

function buildLegacyRecipientWhere(scope: DailySendLimitScope, since: Date, excludedRecipientJobIds: string[]) {
  const campaignFilter = scope.senderProfileId
    ? { senderProfileId: scope.senderProfileId }
    : { userId: scope.userId ?? undefined };

  return {
    updatedAt: { gte: since },
    status: { in: SUCCESSFUL_RECIPIENT_STATUSES },
    providerMessageId: { not: null },
    ...(excludedRecipientJobIds.length > 0 ? { id: { notIn: excludedRecipientJobIds } } : {}),
    campaignRun: {
      campaign: campaignFilter
    }
  };
}

function minDate(...dates: Array<Date | null>) {
  const presentDates = dates.filter((date): date is Date => Boolean(date));
  if (presentDates.length === 0) {
    return null;
  }

  return new Date(Math.min(...presentDates.map((date) => date.getTime())));
}

async function readDbCount(scope: DailySendLimitScope, since: Date) {
  if (!isScopeAddressable(scope)) {
    return { count: 0, oldest: null as Date | null, ledgerAvailable: true };
  }

  const where = buildWhere(scope, since);
  try {
    const ledgerEntries = await prisma.sendLedger.findMany({
      where,
      orderBy: { sentAt: "asc" },
      select: {
        sentAt: true,
        messageId: true,
        recipientJobId: true
      }
    });
    const ledgerRecipientJobIds = [
      ...new Set(
        ledgerEntries
          .map((entry) => entry.recipientJobId)
          .filter((recipientJobId): recipientJobId is string => Boolean(recipientJobId))
      )
    ];
    const successfulLedgerRecipientJobIds =
      ledgerRecipientJobIds.length > 0
        ? new Set(
            (
              await prisma.recipientJob.findMany({
                where: {
                  id: { in: ledgerRecipientJobIds },
                  status: { in: SUCCESSFUL_RECIPIENT_STATUSES }
                },
                select: { id: true }
              })
            ).map((job) => job.id)
          )
        : new Set<string>();
    const countableLedgerEntries = ledgerEntries.filter((entry) => {
      if (!entry.messageId) {
        return false;
      }
      return !entry.recipientJobId || successfulLedgerRecipientJobIds.has(entry.recipientJobId);
    });
    const legacyWhere = buildLegacyRecipientWhere(scope, since, ledgerRecipientJobIds);
    const [legacyCount, legacyOldest] = await Promise.all([
      prisma.recipientJob.count({ where: legacyWhere }),
      prisma.recipientJob.findFirst({
        where: legacyWhere,
        orderBy: { updatedAt: "asc" },
        select: { updatedAt: true }
      })
    ]);
    const ledgerOldest = countableLedgerEntries[0]?.sentAt ?? null;

    return {
      count: countableLedgerEntries.length + legacyCount,
      oldest: minDate(ledgerOldest, legacyOldest?.updatedAt ?? null),
      ledgerAvailable: true
    };
  } catch (error) {
    if (isMissingSendLedgerTableError(error)) {
      warnMissingSendLedgerTable();
      return { count: 0, oldest: null as Date | null, ledgerAvailable: false };
    }

    throw error;
  }
}

/**
 * Returns the current rolling 24-hour Gmail send window for the given scope.
 * The DB ledger is the source of truth; Redis reservations only guard the
 * race window between "decide to send" and "ledger write".
 */
export async function getGmailDailySendWindow(scope: DailySendLimitScope): Promise<DailySendWindow> {
  const limit = getDailySendLimit();
  const now = new Date();
  const windowStart = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const { count, oldest, ledgerAvailable } = await readDbCount(scope, windowStart);

  const sentLast24h = count;
  const isBlocked = ledgerAvailable && sentLast24h >= limit;
  const remaining = ledgerAvailable ? Math.max(0, limit - sentLast24h) : 0;
  const resetAt = isBlocked && oldest ? new Date(oldest.getTime() + ROLLING_WINDOW_MS).toISOString() : null;

  return {
    limit,
    sentLast24h,
    remaining,
    isBlocked,
    ledgerAvailable,
    resetAt,
    oldestCountedSendAt: oldest?.toISOString() ?? null,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString()
  };
}

/**
 * Atomically reserve one send slot in Redis. Concurrency-safe across worker
 * processes. The reservation is short-lived — `recordSendOnLedger` removes it
 * once the DB ledger entry is written (the ledger then carries the count).
 *
 * Falls back to a DB-only window check if Redis is unavailable, so we never
 * silently over-send when caches drop.
 */
export async function reserveSendCapacity(scope: DailySendLimitScope): Promise<ReservationResult> {
  const limit = getDailySendLimit();
  if (limit <= 0 || !isScopeAddressable(scope)) {
    return { allowed: true, reservationId: "noop", remaining: Number.POSITIVE_INFINITY };
  }

  const window = await getGmailDailySendWindow(scope);
  if (!window.ledgerAvailable) {
    return { allowed: false, window };
  }

  if (window.isBlocked) {
    return { allowed: false, window };
  }

  const dbCount = window.sentLast24h;
  const headroom = Math.max(0, limit - dbCount);
  if (headroom === 0) {
    return { allowed: false, window };
  }

  try {
    const redis = getRedis();
    const key = getReservationRedisKey(scope);
    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    // ZADD member must be unique so concurrent reservations don't collide.
    const reservationId = `r:${now}:${Math.random().toString(36).slice(2)}`;

    // Lua script: trim, count, conditionally add. Returns [allowed, count].
    const script = `
      local key = KEYS[1]
      local cutoff = tonumber(ARGV[1])
      local member = ARGV[2]
      local score = tonumber(ARGV[3])
      local cap = tonumber(ARGV[4])
      local dbCount = tonumber(ARGV[5])
      local ttl = tonumber(ARGV[6])
      redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
      local reserved = redis.call('ZCARD', key)
      local total = reserved + dbCount
      if total >= cap then
        return {0, total}
      end
      redis.call('ZADD', key, score, member)
      redis.call('EXPIRE', key, ttl)
      return {1, total + 1}
    `;

    const ttlSeconds = Math.ceil(ROLLING_WINDOW_MS / 1000) + 60;
    const result = (await redis.eval(
      script,
      1,
      key,
      String(cutoff),
      reservationId,
      String(now),
      String(limit),
      String(dbCount),
      String(ttlSeconds)
    )) as [number, number];

    const allowed = result[0] === 1;
    const total = result[1];

    if (!allowed) {
      const refreshed = await getGmailDailySendWindow(scope);
      return { allowed: false, window: refreshed };
    }

    return {
      allowed: true,
      reservationId,
      remaining: Math.max(0, limit - total)
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[daily-send-limit] Redis reservation failed; falling back to DB count.", error);
    }

    if (window.sentLast24h >= limit) {
      return { allowed: false, window };
    }

    return {
      allowed: true,
      reservationId: "fallback",
      remaining: Math.max(0, limit - window.sentLast24h)
    };
  }
}

export async function releaseSendReservation(scope: DailySendLimitScope, reservationId: string) {
  if (!reservationId || reservationId === "noop" || reservationId === "fallback") {
    return;
  }

  if (!isScopeAddressable(scope)) {
    return;
  }

  try {
    const redis = getRedis();
    await redis.zrem(getReservationRedisKey(scope), reservationId);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[daily-send-limit] Failed to release reservation.", error);
    }
  }
}

/**
 * Convenience for callers that only need a hard assertion (no reservation).
 * Throws a `DailySendLimitReachedError` with the resolved window attached.
 */
export class DailySendLimitReachedError extends Error {
  window: DailySendWindow;
  scope: DailySendLimitScope;

  constructor(scope: DailySendLimitScope, window: DailySendWindow) {
    super(
      window.ledgerAvailable
        ? "Gmail daily send safety limit reached for this sender."
        : "Gmail daily send ledger is unavailable."
    );
    this.name = "DailySendLimitReachedError";
    this.window = window;
    this.scope = scope;
  }
}

export async function assertCanSendWithinDailyLimit(scope: DailySendLimitScope) {
  const window = await getGmailDailySendWindow(scope);
  if (!window.ledgerAvailable || window.isBlocked) {
    throw new DailySendLimitReachedError(scope, window);
  }
  return window;
}
