import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";

export const SENDS_PER_MINUTE = 120;

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

export async function consumeSendWindow(key = GLOBAL_SEND_WINDOW_KEY) {
  const redis = getRedis();
  const now = new Date();
  const window = `${key}:${now.toISOString().slice(0, 16)}`;
  const count = await redis.incr(window);
  if (count === 1) {
    await redis.expire(window, 60);
  }

  return {
    allowed: count <= SENDS_PER_MINUTE,
    retryAt: addMinutes(now, 1)
  };
}
