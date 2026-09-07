import { loadEnvConfig } from '@next/env';

// tsx does not load Next's .env files. Load them before importing any env/DB/Redis
// module; explicit shell overrides (notably TEST_DATABASE_URL) keep precedence.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', { info() {}, error() {} });

async function main() {
  const { env } = await import('@/lib/env');
  if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search')
    throw new Error('PUBLIC_SEARCH_CONFIGURATION_REQUIRED');
  if (!env.BRIGHTDATA_API_KEY || !env.BRIGHTDATA_SERP_ZONE) throw new Error('BRIGHTDATA_CONFIGURATION_REQUIRED');
  const { PrismaClient } = await import('@prisma/client');
  const { getRedis } = await import('@/lib/redis');
  const { startDiscoverWorker } = await import('./discover-worker');
  const prisma = new PrismaClient({ log: [] });
  const redis = getRedis();
  const consumer = startDiscoverWorker(prisma, redis as unknown as import('bullmq').ConnectionOptions);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await consumer.close();
    await prisma.$disconnect();
    // Queue instances share the connection. Disconnect after all worker jobs finish.
    redis.disconnect();
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
main().catch(() => {
  console.error('[discover-background]', { event: 'STARTUP_FAILED', message: 'Check Node 22, provider flags, and server environment configuration.' });
  process.exitCode = 1;
});
