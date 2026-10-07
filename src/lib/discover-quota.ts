import type { PrismaClient } from "@prisma/client";

import { isApplicationOwner, normalizeEntitlementEmail } from "@/lib/account-entitlements";
import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";

export const DISCOVER_RESULTS_PER_SEARCH = 10;
export const DISCOVER_PEOPLE_LIMIT_24H = 40;
export const DISCOVER_WINDOW_HOURS = 24;
const WINDOW_MS = DISCOVER_WINDOW_HOURS * 60 * 60 * 1000;
const HOLD_MS = 60 * 60 * 1000;
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export function resolveResultsPerSearch(): number {
  return Math.min(DISCOVER_RESULTS_PER_SEARCH, env.DISCOVER_RESULTS_PER_SEARCH || DISCOVER_RESULTS_PER_SEARCH);
}

export function resolvePeopleLimit(): number {
  return env.DISCOVER_PEOPLE_LIMIT_24H || DISCOVER_PEOPLE_LIMIT_24H;
}

export function normalizeEmail(email: string | null | undefined): string {
  return normalizeEntitlementEmail(email);
}

export function getDiscoverQuotaExemptEmails(): Set<string> {
  return new Set((env.DISCOVER_QUOTA_EXEMPT_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));
}

export function isDiscoverQuotaExempt(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && (isApplicationOwner({ email: normalized }) || getDiscoverQuotaExemptEmails().has(normalized)));
}

export type DiscoverQuotaStatus = {
  resultsPerSearch: number;
  peopleLimit: number;
  peopleUsed: number;
  peopleRemaining: number;
  windowHours: number;
  nextAvailabilityAt: Date | null;
  unlimited: boolean;
};

export type DiscoverQuotaReservation = {
  allowed: boolean;
  status: DiscoverQuotaStatus;
  reservedProfileIds?: string[];
};

export type DiscoverQuotaReserver = (params: {
  userId: string;
  email: string | null;
  searchId: string;
  phase?: "preflight" | "reserve" | "finalize";
  candidateIds?: string[];
  deliveredIds?: string[];
  prisma?: PrismaClient;
}) => Promise<DiscoverQuotaReservation>;

function keys(userId: string, operationId: string) {
  return [
    `discover:people:usage:${userId}`,
    `discover:people:holds:${userId}`,
    `discover:people:reservation:${userId}:${operationId}`
  ];
}

function status(used: number, reserved: number, next: number | null, unlimited = false): DiscoverQuotaStatus {
  const limit = resolvePeopleLimit();
  return {
    resultsPerSearch: resolveResultsPerSearch(), peopleLimit: limit,
    peopleUsed: Math.min(limit, Math.max(0, used)),
    peopleRemaining: unlimited ? limit : Math.max(0, limit - used - reserved),
    windowHours: DISCOVER_WINDOW_HOURS,
    nextAvailabilityAt: unlimited || next === null ? null : new Date(next + WINDOW_MS),
    unlimited
  };
}

// The Redis script is the allocation gate: committed entries and active holds
// are counted together, so simultaneous searches cannot exceed the limit.
const QUOTA_SCRIPT = `
  local usage, holds, operation = KEYS[1], KEYS[2], KEYS[3]
  local phase, now, window, holdMs, limit, ttl = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
  redis.call('ZREMRANGEBYSCORE', usage, '-inf', now - window)
  redis.call('ZREMRANGEBYSCORE', holds, '-inf', now)
  local count = tonumber(redis.call('ZCARD', usage))
  local held = tonumber(redis.call('ZCARD', holds))
  local first = redis.call('ZRANGE', usage, 0, 0, 'WITHSCORES')
  local next = first[2] or ''
  if phase == 'reserve' then
    local selected = {}
    local seen = {}
    for i = 7, #ARGV do
      local id = ARGV[i]
      if not seen[id] then
        seen[id] = true
        if redis.call('ZSCORE', usage, id) then
          table.insert(selected, id)
        elseif redis.call('ZSCORE', holds, id) then
          if redis.call('SISMEMBER', operation, id) == 1 then table.insert(selected, id) end
        elseif count + held < limit then
          redis.call('ZADD', holds, now + holdMs, id)
          redis.call('SADD', operation, id)
          held = held + 1
          table.insert(selected, id)
        end
      end
    end
    redis.call('EXPIRE', holds, ttl)
    redis.call('EXPIRE', operation, math.ceil(holdMs / 1000))
    redis.call('EXPIRE', usage, ttl)
    return {count, held, next, unpack(selected)}
  end
  if phase == 'finalize' then
    local delivered = {}
    for i = 7, #ARGV do delivered[ARGV[i]] = true end
    local reserved = redis.call('SMEMBERS', operation)
    for _, id in ipairs(reserved) do
      if delivered[id] then redis.call('ZADD', usage, 'NX', now, id) end
      redis.call('ZREM', holds, id)
    end
    redis.call('DEL', operation)
    redis.call('EXPIRE', usage, ttl)
    count = tonumber(redis.call('ZCARD', usage))
    held = tonumber(redis.call('ZCARD', holds))
    first = redis.call('ZRANGE', usage, 0, 0, 'WITHSCORES')
    next = first[2] or ''
  end
  return {count, held, next}
`;

// Rebuild committed use from durable grants after a crash between the database
// allocation and Redis finalization. Existing scores keep their first timestamp.
async function reconcile(userId: string, prisma?: PrismaClient, now = Date.now()): Promise<void> {
  if (!prisma) return;
  const cutoff = new Date(now - WINDOW_MS);
  const recent = await prisma.prospectSearchPerson.findMany({
    where: { userId, allocatedAt: { gt: cutoff } },
    select: { personId: true }
  });
  if (!recent.length) return;
  // A later search may reuse an existing person for free. Look up the first
  // durable grant across the user's history so that replay/reuse never starts
  // a new 24-hour charge. REPROCESS is an operator repair, not user usage.
  const rows = await prisma.prospectSearchPerson.findMany({
    where: { userId, personId: { in: [...new Set(recent.map((row) => row.personId))] } },
    orderBy: { allocatedAt: "asc" },
    select: { personId: true, allocatedAt: true, allocationSource: true,
      person: { select: { sourceProfileId: true } } }
  });
  const usageKey = keys(userId, "reconcile")[0];
  const pipeline = getRedis().pipeline();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.personId)) continue;
    seen.add(row.personId);
    if (row.allocatedAt <= cutoff || row.allocationSource === "REPROCESS") continue;
    pipeline.zadd(usageKey, "NX", row.allocatedAt.getTime(), row.person.sourceProfileId);
  }
  pipeline.expire(usageKey, KEY_TTL_SECONDS);
  await pipeline.exec();
}

export async function getDiscoverQuotaStatus(userId: string, email: string | null, prisma?: PrismaClient): Promise<DiscoverQuotaStatus> {
  if (isDiscoverQuotaExempt(email)) return status(0, 0, null, true);
  try {
    const now = Date.now();
    await reconcile(userId, prisma, now);
    const result = await getRedis().eval(QUOTA_SCRIPT, 3, ...keys(userId, "status"), "preflight", now, WINDOW_MS, HOLD_MS, resolvePeopleLimit(), KEY_TTL_SECONDS) as [number, number, string];
    return status(Number(result[0]), Number(result[1]), result[2] ? Number(result[2]) : null);
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    return status(0, 0, null);
  }
}

export const reserveDiscoverPeople: DiscoverQuotaReserver = async (params) => {
  if (isDiscoverQuotaExempt(params.email)) {
    return { allowed: true, status: status(0, 0, null, true), reservedProfileIds: params.candidateIds ?? [] };
  }
  try {
    const now = Date.now();
    await reconcile(params.userId, params.prisma, now);
    const phase = params.phase ?? "preflight";
    const values = phase === "finalize" ? params.deliveredIds ?? [] : params.candidateIds ?? [];
    const result = await getRedis().eval(
      QUOTA_SCRIPT, 3, ...keys(params.userId, params.searchId), phase, now, WINDOW_MS,
      HOLD_MS, resolvePeopleLimit(), KEY_TTL_SECONDS, ...values
    ) as [number, number, string, ...string[]];
    const quotaStatus = status(Number(result[0]), Number(result[1]), result[2] ? Number(result[2]) : null);
    const reservedProfileIds = phase === "reserve" ? result.slice(3).map(String) : [];
    return {
      allowed: phase === "preflight" ? quotaStatus.peopleRemaining > 0 : phase === "reserve" ? reservedProfileIds.length > 0 : true,
      status: quotaStatus, reservedProfileIds
    };
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    return { allowed: true, status: status(0, 0, null), reservedProfileIds: params.candidateIds ?? [] };
  }
};

export function formatDiscoverLimitMessage(status: DiscoverQuotaStatus): string {
  return `You've reached your Discover limit of ${status.peopleLimit} people in the last 24 hours. More people will become available as earlier results leave the 24-hour window.`;
}

export const formatDiscoverExpansionLimitMessage = formatDiscoverLimitMessage;
