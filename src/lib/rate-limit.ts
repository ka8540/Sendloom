import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";

/**
 * Default per-sender send cap (per minute). Gmail's anti-abuse rate limiter trips
 * well below the API's documented per-second quota, so we pace hard and per sender.
 * Earlier values (120/min, then 30/min) still let large sequences mass-fail once
 * Gmail began rate limiting. 3/min per connected sender keeps a single mailbox far
 * under the limit. This is the single source of truth — override with
 * GMAIL_SENDS_PER_MINUTE. It is independent of the rolling 24h daily safety cap
 * (GMAIL_DAILY_SEND_SAFETY_LIMIT), which is enforced separately.
 */
export const DEFAULT_GMAIL_SENDS_PER_MINUTE = 3;

/** Resolved per-sender send cap (per minute), configurable via GMAIL_SENDS_PER_MINUTE. */
export function getGmailSendsPerMinute() {
  const configured = env.GMAIL_SENDS_PER_MINUTE;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GMAIL_SENDS_PER_MINUTE;
}

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const RATE_LIMIT_PREFIX = "rate-limit";

export async function rateLimit({ key, limit, windowSeconds }: RateLimitOptions): Promise<RateLimitResult> {
  if (limit <= 0 || windowSeconds <= 0) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  try {
    const redis = getRedis();
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const windowKey = `${RATE_LIMIT_PREFIX}:${key}:${bucket}`;
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.expire(windowKey, windowSeconds);
    }

    const ttl = await redis.ttl(windowKey);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds
    };
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    if (process.env.NODE_ENV !== "test") {
      console.warn("[rate-limit] Redis unavailable, allowing request in development.");
    }

    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export function createRateLimitResponse(retryAfterSeconds: number) {
  const headers: Record<string, string> = {};
  if (retryAfterSeconds > 0) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }

  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers }
  );
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

const GLOBAL_SEND_WINDOW_KEY = "gmail-send-rate:global";
const SEND_WINDOW_PREFIX = "gmail-send-rate";

type SendWindowScope = {
  userId?: string | null;
  senderProfileId?: string | null;
};

/**
 * Resolve the Redis key that scopes the per-minute send window. Pacing is
 * per connected Gmail sender, so the sender profile is preferred; the user id
 * is only a fallback for the rare scope with no sender (kept for safety — every
 * campaign has a senderProfileId, so the sender branch is what runs in practice).
 */
export function getSendWindowKey(scope: SendWindowScope = {}) {
  if (scope.senderProfileId) {
    return `${SEND_WINDOW_PREFIX}:sender:${scope.senderProfileId}`;
  }

  if (scope.userId) {
    return `${SEND_WINDOW_PREFIX}:user:${scope.userId}`;
  }

  return GLOBAL_SEND_WINDOW_KEY;
}

/** Even spacing (ms) implied by a per-minute cap. Informational helper only. */
export function getSendWindowSpacingMs(limit = getGmailSendsPerMinute()) {
  return Math.max(1, Math.ceil(60_000 / Math.max(1, limit)));
}

export type SendWindowResult = {
  allowed: boolean;
  retryAt: Date;
  reason: "allowed" | "window";
  count: number;
  limit: number;
};

/**
 * Atomically consume one slot from the sender's per-minute send window.
 *
 * A fixed 60-second bucket holds at most `GMAIL_SENDS_PER_MINUTE` sends. The
 * INCR + conditional EXPIRE run inside a single Lua script so concurrent
 * workers/processes can never over-consume the window — even 10 workers racing
 * the same sender see one atomic counter. When the window is full the caller is
 * told the exact time the bucket frees (`retryAt`) and must defer the job; it
 * must NOT call Gmail or mark the recipient failed.
 *
 * This intentionally does not enforce sub-second spacing: at 3/min that would
 * push slots ~20s apart, further than a single tick can wait, which previously
 * collapsed throughput. The per-minute count alone is what protects Gmail.
 */
export async function consumeSendWindow(key = GLOBAL_SEND_WINDOW_KEY): Promise<SendWindowResult> {
  const limit = getGmailSendsPerMinute();
  const now = Date.now();
  const windowKey = `${key}:${new Date(now).toISOString().slice(0, 16)}`;

  if (limit <= 0) {
    return { allowed: false, retryAt: new Date(now + 60_000), reason: "window", count: 0, limit };
  }

  const script = `
    local windowKey = KEYS[1]
    local now = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local count = tonumber(redis.call('GET', windowKey) or '0')
    if count >= limit then
      local ttl = redis.call('PTTL', windowKey)
      if ttl < 0 then ttl = 60000 end
      return {0, now + ttl, count}
    end
    count = redis.call('INCR', windowKey)
    if count == 1 then
      redis.call('EXPIRE', windowKey, 60)
    end
    return {1, now, count}
  `;

  try {
    const result = (await getRedis().eval(script, 1, windowKey, String(now), String(limit))) as [
      number,
      number,
      number
    ];
    const allowed = result[0] === 1;
    return {
      allowed,
      retryAt: new Date(allowed ? now : result[1]),
      reason: allowed ? "allowed" : "window",
      count: result[2],
      limit
    };
  } catch (error) {
    // In production a missing Redis must not silently disable pacing — fail
    // closed by deferring (caller requeues), mirroring the daily-limit guard.
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    if (process.env.NODE_ENV !== "test") {
      console.warn("[rate-limit] Redis unavailable; allowing send window in development.");
    }
    return { allowed: true, retryAt: new Date(now), reason: "allowed", count: 1, limit };
  }
}
