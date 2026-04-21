import { addMinutes } from "date-fns";

import { getRedis } from "@/lib/redis";

export const SENDS_PER_MINUTE = 120;
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
