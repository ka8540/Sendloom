import { addMinutes } from "date-fns";

import { redis } from "@/lib/redis";

export const SENDS_PER_MINUTE = 120;

export async function consumeSendWindow(key = "global-send-window") {
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
