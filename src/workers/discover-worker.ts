import { Worker, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { enqueuePendingPublicPools, runPublicPoolJob } from '@/services/prospects/discover-public-pool-job';

/** Shared consumer for the main worker and the Discover-only local entry point. */
export function startDiscoverWorker(prisma: PrismaClient, connection: ConnectionOptions) {
  const worker = new Worker('discover-public-pool', async job => {
    console.info('[discover-background]', { event: 'JOB_STARTED' });
    await runPublicPoolJob(prisma, job.data.fingerprint);
    console.info('[discover-background]', { event: 'JOB_COMPLETED' });
  }, { connection, concurrency: 2 });
  worker.on('failed', () => console.warn('[discover-background]', { event: 'JOB_FAILED_RETRYABLE' }));
  worker.on('error', () => console.warn('[discover-background]', { event: 'QUEUE_CONNECTION_ERROR' }));
  let recovering = false;
  let recovery: Promise<void> = Promise.resolve();
  const recover = () => {
    if (recovering) return;
    recovering = true;
    recovery = enqueuePendingPublicPools(prisma)
      .catch(() => { console.warn('[discover-background]', { event: 'RECOVERY_RETRY_REQUIRED' }); })
      .finally(() => { recovering = false; });
  };
  // A long-lived worker owns this timer, never a serverless HTTP request.
  recover();
  const timer = setInterval(recover, 60_000);
  console.info('[discover-background]', { event: 'WORKER_STARTED', recoveryIntervalMs: 60_000 });
  return { worker, async close() { clearInterval(timer); await recovery; await worker.close(); } };
}
