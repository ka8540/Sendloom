import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";

/**
 * Discover daily usage limits.
 *
 * Ordinary users get a fixed, server-enforced product quota:
 *   - exactly DISCOVER_RESULTS_PER_SEARCH people per processed search (the user
 *     never chooses the result count), and
 *   - DISCOVER_DAILY_SEARCH_LIMIT processed searches per daily window.
 *
 * Creating a draft is free; the quota is consumed atomically the moment a draft
 * is processed, right before the paid Apify/AI discovery pipeline runs. Each
 * search can only ever consume one slot (idempotent per search id), so retries
 * — double clicks, browser/network retries, refreshes, or re-processing a
 * FAILED search — never cost a second slot.
 *
 * Both values default to the documented product limits and can be overridden by
 * env for operations only; the enforced defaults remain 10 results / 4 searches.
 * This module is the single server-side source of truth for the quota and the
 * exempt-email allowlist — none of it is ever sent to the client.
 */
export const DISCOVER_RESULTS_PER_SEARCH = 10;
export const DISCOVER_DAILY_SEARCH_LIMIT = 4;

const DAILY_COUNTER_PREFIX = "discover:quota";
const SEARCH_SLOT_PREFIX = "discover:quota:search";

// A search's "slot consumed" marker outlives the one-day counter so that
// retrying the SAME search (even a day later, after a provider failure) never
// consumes a second slot. New searches still cost a slot, so this cannot be
// used to bypass the daily limit.
const SEARCH_SLOT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Effective per-search result ceiling (env override, defaulting to 10). */
export function resolveResultsPerSearch(): number {
  const configured = env.DISCOVER_RESULTS_PER_SEARCH;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : DISCOVER_RESULTS_PER_SEARCH;
}

/** Effective processed-searches-per-day ceiling (env override, defaulting to 4). */
export function resolveDailySearchLimit(): number {
  const configured = env.DISCOVER_DAILY_SEARCH_LIMIT;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : DISCOVER_DAILY_SEARCH_LIMIT;
}

/** Trim + lowercase an email for case-insensitive comparison. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Server-only allowlist of canonical emails exempt from the DAILY quota.
 * Parsed lazily (never at module scope) so a blank env line is treated as empty
 * and the build never trips the production env refinement. Comma-separated.
 */
export function getDiscoverQuotaExemptEmails(): Set<string> {
  return new Set(
    (env.DISCOVER_QUOTA_EXEMPT_EMAILS ?? "")
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
}

/**
 * Whether the AUTHENTICATED account is exempt from the daily Discover quota.
 * The email must be resolved from the session/user record by the caller — never
 * from a request body, GraphQL input, or local storage.
 */
export function isDiscoverQuotaExempt(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  return getDiscoverQuotaExemptEmails().has(normalized);
}

export type DiscoverQuotaStatus = {
  resultsPerSearch: number;
  dailySearchLimit: number;
  searchesUsed: number;
  searchesRemaining: number;
  resetAt: Date;
  unlimited: boolean;
};

export type DiscoverQuotaReservation = {
  allowed: boolean;
  status: DiscoverQuotaStatus;
};

/** The injectable quota reserver shape (so the service can be unit-tested). */
export type DiscoverQuotaReserver = (params: {
  userId: string;
  /** The authenticated account email, resolved from the session. */
  email: string | null;
  searchId: string;
}) => Promise<DiscoverQuotaReservation>;

/**
 * The current daily window. A fixed UTC calendar day: the counter key carries
 * the date, expires at the next UTC midnight, and `resetAt` is that midnight so
 * the UI can show exactly when access returns. (Sendloom stores no per-user
 * timezone; UTC is the project's established server-side default.)
 */
function getQuotaWindow(now: Date = new Date()): { quotaDate: string; resetAt: Date; ttlSeconds: number } {
  const quotaDate = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const resetAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  const ttlSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  return { quotaDate, resetAt, ttlSeconds };
}

function exemptStatus(resetAt: Date): DiscoverQuotaStatus {
  const limit = resolveDailySearchLimit();
  return {
    resultsPerSearch: resolveResultsPerSearch(),
    dailySearchLimit: limit,
    searchesUsed: 0,
    searchesRemaining: limit,
    resetAt,
    unlimited: true
  };
}

function buildStatus(usedRaw: number, resetAt: Date): DiscoverQuotaStatus {
  const limit = resolveDailySearchLimit();
  const used = Math.min(Math.max(0, usedRaw), limit);
  return {
    resultsPerSearch: resolveResultsPerSearch(),
    dailySearchLimit: limit,
    searchesUsed: used,
    searchesRemaining: Math.max(0, limit - used),
    resetAt,
    unlimited: false
  };
}

function dailyKey(userId: string, quotaDate: string): string {
  return `${DAILY_COUNTER_PREFIX}:${userId}:${quotaDate}`;
}

function searchSlotKey(searchId: string): string {
  return `${SEARCH_SLOT_PREFIX}:${searchId}`;
}

/**
 * Read-only Discover quota status for the authenticated user. Never mutates the
 * counter — used by the `discoverQuota` query and the dashboard indicator. On a
 * Redis read failure it reports an optimistic zero-used status; the only
 * authoritative gate is the atomic reservation below.
 */
export async function getDiscoverQuotaStatus(
  userId: string,
  email: string | null
): Promise<DiscoverQuotaStatus> {
  const { quotaDate, resetAt } = getQuotaWindow();

  if (isDiscoverQuotaExempt(email)) {
    return exemptStatus(resetAt);
  }

  try {
    const raw = await getRedis().get(dailyKey(userId, quotaDate));
    const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
    return buildStatus(used, resetAt);
  } catch {
    return buildStatus(0, resetAt);
  }
}

// Atomic reserve: idempotent per search, fixed daily ceiling. Runs entirely in
// one Lua eval so concurrent requests can never over-consume or double-count.
const RESERVE_SCRIPT = `
  local dailyKey = KEYS[1]
  local searchKey = KEYS[2]
  local limit = tonumber(ARGV[1])
  local dailyTtl = tonumber(ARGV[2])
  local searchTtl = tonumber(ARGV[3])

  -- This exact search already reserved a slot: allow without re-consuming.
  if redis.call('EXISTS', searchKey) == 1 then
    local current = tonumber(redis.call('GET', dailyKey) or '0')
    return {1, current}
  end

  local count = tonumber(redis.call('GET', dailyKey) or '0')
  if count >= limit then
    return {0, count}
  end

  count = redis.call('INCR', dailyKey)
  if count == 1 then
    redis.call('EXPIRE', dailyKey, dailyTtl)
  end
  redis.call('SET', searchKey, '1')
  redis.call('EXPIRE', searchKey, searchTtl)
  return {1, count}
`;

/**
 * Atomically reserve one daily Discover slot for processing `searchId`.
 *
 * - Exempt accounts (resolved from the authenticated email) are always allowed
 *   and never consume a slot.
 * - The same search id can be reserved repeatedly without consuming more than
 *   one slot (idempotent retries).
 * - The check + increment are a single atomic Lua eval, so simultaneous
 *   requests cannot exceed the daily limit.
 *
 * Redis failures fail closed in production (rethrow) so the paid pipeline never
 * runs unmetered; in development/test they fail open so local work isn't blocked
 * by a missing Redis.
 */
export async function reserveDiscoverSearchSlot(params: {
  userId: string;
  email: string | null;
  searchId: string;
}): Promise<DiscoverQuotaReservation> {
  const { quotaDate, resetAt, ttlSeconds } = getQuotaWindow();

  if (isDiscoverQuotaExempt(params.email)) {
    return { allowed: true, status: exemptStatus(resetAt) };
  }

  const limit = resolveDailySearchLimit();

  try {
    const result = (await getRedis().eval(
      RESERVE_SCRIPT,
      2,
      dailyKey(params.userId, quotaDate),
      searchSlotKey(params.searchId),
      String(limit),
      String(ttlSeconds),
      String(SEARCH_SLOT_TTL_SECONDS)
    )) as [number, number];

    return { allowed: result[0] === 1, status: buildStatus(result[1], resetAt) };
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    if (process.env.NODE_ENV !== "test") {
      console.warn("[discover-quota] Redis unavailable; allowing Discover search in development.");
    }
    return { allowed: true, status: buildStatus(0, resetAt) };
  }
}

/** A clean, user-safe limit message that never leaks internal counters/keys. */
export function formatDiscoverLimitMessage(status: DiscoverQuotaStatus): string {
  return `You have used today's ${status.dailySearchLimit} Discover searches. You can search again after ${formatQuotaReset(
    status.resetAt
  )}.`;
}

/** Format the reset timestamp in UTC so the message is never timezone-ambiguous. */
export function formatQuotaReset(resetAt: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(resetAt);
  return `${formatted} UTC`;
}
