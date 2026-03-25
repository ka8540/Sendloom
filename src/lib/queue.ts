import { Queue, type ConnectionOptions } from "bullmq";

import { getRedis } from "@/lib/redis";

const globalForQueues = globalThis as unknown as {
  queues?: {
    validation: Queue;
    launch: Queue;
    send: Queue;
    webhook: Queue;
  };
};

function getQueues() {
  if (!globalForQueues.queues) {
    const connection = getRedis() as unknown as ConnectionOptions;

    globalForQueues.queues = {
      validation: new Queue("validation", { connection }),
      launch: new Queue("launch", { connection }),
      send: new Queue("send", { connection }),
      webhook: new Queue("webhook", { connection })
    };
  }

  return globalForQueues.queues;
}

export const queues = {
  get validation() {
    return getQueues().validation;
  },
  get launch() {
    return getQueues().launch;
  },
  get send() {
    return getQueues().send;
  },
  get webhook() {
    return getQueues().webhook;
  }
};
