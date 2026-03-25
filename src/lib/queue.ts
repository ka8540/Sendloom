import { Queue, type ConnectionOptions } from "bullmq";

import { redis } from "@/lib/redis";

const connection = redis as unknown as ConnectionOptions;

export const queues = {
  validation: new Queue("validation", { connection }),
  launch: new Queue("launch", { connection }),
  send: new Queue("send", { connection }),
  webhook: new Queue("webhook", { connection })
};
