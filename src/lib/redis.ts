import IORedis from "ioredis";

import { env } from "@/lib/env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export function getRedis() {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null
    });
  }

  return globalForRedis.redis;
}

export const redis = new Proxy({} as IORedis, {
  get(_, prop) {
    const client = getRedis();
    const value = client[prop as keyof IORedis];
    return typeof value === "function" ? value.bind(client) : value;
  }
});
