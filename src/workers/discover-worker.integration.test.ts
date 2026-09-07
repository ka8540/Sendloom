import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createFakePrisma } from '@/services/prospects/__test-utils__/fake-prisma';
import { DiscoverSearchCacheService } from '@/services/prospects/discover-cache-service';
import { startDiscoverWorker } from './discover-worker';
import { enqueuePublicPool } from '@/services/prospects/discover-public-pool-job';
import { getRedis } from '@/lib/redis';
import { queues } from '@/lib/queue';
import { getEnv } from '@/lib/env';
import type { ConnectionOptions } from 'bullmq';

// Explicit disposable UNIX socket only: never consume the application's queue.
describe.runIf(process.env.DISCOVER_TEST_REDIS_SOCKET?.startsWith('/tmp/sendloom-discover-test-'))('real Redis discovery consumer', () => {
  it('consumes one deduplicated job and fills the pool without any Add More request', async () => {
    const env = getEnv(); const previous = { ...env };
    Object.assign(env, { REDIS_URL: process.env.DISCOVER_TEST_REDIS_SOCKET, WEB_SEARCH_PROVIDER: 'brightdata_google',
      DISCOVER_PEOPLE_PROVIDER: 'public_search', BRIGHTDATA_API_KEY: 'fixture', BRIGHTDATA_SERP_ZONE: 'fixture',
      PROSPECT_AI_ENABLED: false, DISCOVER_ROLE_VECTOR_ENABLED: false, DISCOVER_PUBLIC_MAX_RESULTS: 100, DISCOVER_PUBLIC_MAX_PAGES: 10 });
    const db = createFakePrisma();
    const cache = new DiscoverSearchCacheService({ prisma: db as unknown as PrismaClient });
    const fingerprint = 'isolated-consumer-fixture';
    const format = { emailDomain: 'example.org', emailDomainConfidence: 'HIGH', emailDomainEvidence: null,
      emailPattern: 'first.last', patternConfidence: 'HIGH', patternEvidence: null, emailFormatReason: null };
    await cache.appendProviderPeople({ fingerprint, fingerprintInput: { companyKey: 'domain:example.org', roles: ['software engineer'],
      locations: ['united states'], resultLimit: 10, cacheVersion: 'v1' }, company: { name: 'Example', domain: 'example.org', linkedinUrl: null },
      emailFormat: format, people: Array.from({ length: 10 }, (_, i) => ({ sourceProfileId: `person-${i}`, firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe',
        currentTitle: 'Software Engineer', normalizedTitle: 'software engineer', positionCategory: 'SOFTWARE_ENGINEERING', location: 'United States', country: 'United States',
        city: null, state: null, linkedinUrl: `https://linkedin.com/in/person-${i}`, inferredEmail: null, emailStatus: 'UNAVAILABLE',
        emailConfidence: 'UNAVAILABLE', emailPattern: null, emailSource: null })),
      nextPage: 2, pagesFetched: 1, exhausted: false,
      publicExpansion: { provider: 'brightdata_google', titles: ['Software Engineer'], seenProfileIds: Array.from({ length: 10 }, (_, i) => `person-${i}`), rawCount: 10 } });
    const starts: number[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const start = Number(new URL(JSON.parse(options!.body as string).url).searchParams.get('start'));
      starts.push(start);
      expect(db._state.discoverCachePeople).toHaveLength(start); // Prior batch committed before this request.
      return Response.json({ organic: Array.from({ length: 10 }, (_, i) => ({ title: 'Jane Doe - Software Engineer at Example | LinkedIn',
        link: `https://np.linkedin.com/in/person-${start + i}`, description: '' })) });
    });
    const consumer = startDiscoverWorker(db as unknown as PrismaClient, getRedis() as unknown as ConnectionOptions);
    try {
      const completed = new Promise<void>((resolve, reject) => {
        consumer.worker.once('completed', () => resolve());
        consumer.worker.once('failed', () => reject(new Error('Fixture worker failed')));
      });
      await Promise.all([enqueuePublicPool(fingerprint), enqueuePublicPool(fingerprint)]);
      await completed;
      expect(starts).toEqual([10,20,30,40,50,60,70,80,90]);
      expect(db._state.discoverCachePeople).toHaveLength(100);
      expect(db._state.people).toHaveLength(0); expect(db._state.searchPeople).toHaveLength(0);
      expect(db._state.discoverCache[0]).toMatchObject({ providerNextPage: 11, providerExhausted: true });
    } finally {
      await consumer.close();
      await Promise.all(Object.values(queues).map(queue => queue.close()));
      getRedis().disconnect(); Object.assign(env, previous);
    }
  }, 15_000);
});
