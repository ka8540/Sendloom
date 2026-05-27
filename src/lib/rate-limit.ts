import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";

export const SENDS_PER_MINUTE = 120;
export const SEND_WINDOW_MAX_PACING_WAIT_MS = 10_000;

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

const GLOBAL_SEND_WINDOW_KEY = "global-send-window";
const USER_SEND_WINDOW_PREFIX = "user-send-window";
const SENDER_SEND_WINDOW_PREFIX = "sender-send-window";
const SEND_WINDOW_PACE_SUFFIX = "pace";

type SendWindowScope = {
  userId?: string | null;
  senderProfileId?: string | null;
};

export function getSendWindowKey(scope: SendWindowScope = {}) {
  if (scope.userId) {
    return `${USER_SEND_WINDOW_PREFIX}:${scope.userId}`;
  }

  if (scope.senderProfileId) {
    return `${SENDER_SEND_WINDOW_PREFIX}:${scope.senderProfileId}`;
  }

  return GLOBAL_SEND_WINDOW_KEY;
}

export function getSendWindowSpacingMs(limit = SENDS_PER_MINUTE) {
  return Math.max(1, Math.ceil(60_000 / Math.max(1, limit)));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function tryConsumeSendWindow(key: string) {
  const redis = getRedis();
  const now = Date.now();
  const window = `${key}:${new Date(now).toISOString().slice(0, 16)}`;
  const paceKey = `${key}:${SEND_WINDOW_PACE_SUFFIX}`;
  const spacingMs = getSendWindowSpacingMs();
  const paceTtlMs = Math.max(1_000, spacingMs * 4);
  const script = `
    local windowKey = KEYS[1]
    local paceKey = KEYS[2]
    local now = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local spacingMs = tonumber(ARGV[3])
    local paceTtlMs = tonumber(ARGV[4])
    local count = tonumber(redis.call('GET', windowKey) or '0')
    if count >= limit then
      local ttl = redis.call('TTL', windowKey)
      if ttl < 0 then ttl = 60 end
      return {0, now + (ttl * 1000), 'window', count}
    end

    local nextAt = tonumber(redis.call('GET', paceKey) or '0')
    if nextAt > now then
      return {0, nextAt, 'pacing', count}
    end

    count = redis.call('INCR', windowKey)
    if count == 1 then
      redis.call('EXPIRE', windowKey, 60)
    end
    redis.call('SET', paceKey, now + spacingMs, 'PX', paceTtlMs)
    return {1, now + spacingMs, 'allowed', count}
  `;
  const result = (await redis.eval(
    script,
    2,
    window,
    paceKey,
    String(now),
    String(SENDS_PER_MINUTE),
    String(spacingMs),
    String(paceTtlMs)
  )) as [number, number, "allowed" | "window" | "pacing", number];

  return {
    allowed: result[0] === 1,
    retryAt: new Date(result[1]),
    reason: result[2],
    count: result[3]
  };
}

export async function consumeSendWindow(
  key = GLOBAL_SEND_WINDOW_KEY,
  options: { maxPacingWaitMs?: number } = {}
) {
  const maxPacingWaitMs = options.maxPacingWaitMs ?? SEND_WINDOW_MAX_PACING_WAIT_MS;
  const startedAt = Date.now();

  for (;;) {
    const result = await tryConsumeSendWindow(key);
    if (result.allowed) {
      return result;
    }

    const waitMs = result.retryAt.getTime() - Date.now();
    const wouldExceedWaitBudget = Date.now() + waitMs - startedAt > maxPacingWaitMs;
    if (result.reason !== "pacing" || waitMs <= 0 || wouldExceedWaitBudget) {
      return result;
    }

    await sleep(waitMs);
  }
}
