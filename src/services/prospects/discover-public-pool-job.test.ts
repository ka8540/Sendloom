import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const add = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/queue', () => ({ queues: { discover: { add } } }));
import { enqueuePublicPool, enqueuePendingPublicPools } from './discover-public-pool-job';
import { getEnv } from '@/lib/env';
import type { PrismaClient } from '@prisma/client';
let previous: { WEB_SEARCH_PROVIDER: ReturnType<typeof getEnv>['WEB_SEARCH_PROVIDER']; DISCOVER_PEOPLE_PROVIDER: ReturnType<typeof getEnv>['DISCOVER_PEOPLE_PROVIDER'] };
beforeEach(() => {
  const env = getEnv(); previous = { WEB_SEARCH_PROVIDER: env.WEB_SEARCH_PROVIDER, DISCOVER_PEOPLE_PROVIDER: env.DISCOVER_PEOPLE_PROVIDER };
  Object.assign(env, { WEB_SEARCH_PROVIDER: 'brightdata_google', DISCOVER_PEOPLE_PROVIDER: 'public_search' }); add.mockClear();
});
afterEach(() => Object.assign(getEnv(), previous));
it('uses the same BullMQ job identity for concurrent requests, with bounded retries', async () => {
  await Promise.all([enqueuePublicPool('shared-key'), enqueuePublicPool('shared-key')]);
  expect(add.mock.calls).toHaveLength(2);
  expect(add).toHaveBeenNthCalledWith(1, 'fill-public-pool', { fingerprint: 'shared-key' }, {
    jobId: 'public-pool-shared-key', attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: true
  });
  expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
});
it('scheduler recovers incomplete DB commits without putting personal records into jobs', async () => {
  const findMany = vi.fn(async () => [{ fingerprint: 'recovery-key' }]);
  await enqueuePendingPublicPools({ discoverSearchCache: { findMany } } as unknown as PrismaClient);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerExhausted: false,
    publicExpansion: { path: ['provider'], equals: 'brightdata_google' } }), take: 20 }));
  expect(add).toHaveBeenCalledWith('fill-public-pool', { fingerprint: 'recovery-key' }, expect.any(Object));
});
it('does not schedule another provider mode', async () => {
  getEnv().WEB_SEARCH_PROVIDER = 'none'; await enqueuePublicPool('key'); expect(add).not.toHaveBeenCalled();
});
