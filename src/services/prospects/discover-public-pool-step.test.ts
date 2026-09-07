import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createFakePrisma } from './__test-utils__/fake-prisma';
import { DiscoverSearchCacheService } from './discover-cache-service';
import { runPublicPoolStep, runPublicPoolJob, isPendingPublicPool, pendingPublicPoolWhere } from './discover-public-pool-job';
import { getEnv } from '@/lib/env';
vi.mock('@/lib/queue', () => ({ queues: { discover: { add: vi.fn() } } }));
let previous: ReturnType<typeof getEnv>;
beforeEach(() => { previous = { ...getEnv() }; Object.assign(getEnv(), { WEB_SEARCH_PROVIDER: 'brightdata_google',
 DISCOVER_PEOPLE_PROVIDER: 'public_search', BRIGHTDATA_API_KEY: 'fixture', BRIGHTDATA_SERP_ZONE: 'fixture',
 PROSPECT_AI_ENABLED: false, DISCOVER_ROLE_VECTOR_ENABLED: false, DISCOVER_PUBLIC_MAX_RESULTS: 100, DISCOVER_PUBLIC_MAX_PAGES: 10 }); });
afterEach(() => Object.assign(getEnv(), previous));
async function setup() {
 let held = false;
 const lock = { acquire: async () => { if (held) return null; held = true; return 'token'; }, release: async () => { held = false; } };
    const db = createFakePrisma();
    const cache = new DiscoverSearchCacheService({ prisma: db as unknown as PrismaClient, lock, waitTimeoutMs: 0 });
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

 return { db, cache, fingerprint, prisma: db as unknown as PrismaClient };
}
it('READY caches advance exactly one page, storing accepted people and deduplicating canonical LinkedIn URLs', async () => {
 const { db, cache, fingerprint, prisma } = await setup();
 vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [
 { title: 'Jane Doe - Software Engineer at Example | LinkedIn', link: 'https://np.linkedin.com/in/person-10', description: '' },
 { title: 'Jane Doe - Software Engineer at Example | LinkedIn', link: 'https://www.linkedin.com/in/person-10/', description: '' },
 { title: 'Jane Doe - Software Engineer at Example | LinkedIn', link: 'https://linkedin.com/in/person-0', description: '' }
 ] }));
 expect(isPendingPublicPool(db._state.discoverCache[0] as never)).toBe(true);
 const result = await runPublicPoolStep(prisma, fingerprint, cache);
 expect(result).toEqual({ pagesProcessed: 1, peopleInserted: 1 });
 expect(fetch).toHaveBeenCalledOnce();
 expect(db._state.discoverCache[0]).toMatchObject({ status: 'READY', providerNextPage: 3, resultCount: 11 });
 expect(db._state.discoverCachePeople).toHaveLength(11);
 expect(db._state.people).toHaveLength(0);
});
it.each([{ providerExhausted: true }, { providerNextPage: 11 }, { resultCount: 100 }, { expiresAt: new Date(0) }])('skips finished/ineligible state %j', async patch => {
 const { db, cache, fingerprint, prisma } = await setup();
 Object.assign(db._state.discoverCache[0], patch);
 expect(isPendingPublicPool(db._state.discoverCache[0] as never)).toBe(false);
 expect(await runPublicPoolStep(prisma, fingerprint, cache)).toEqual({ pagesProcessed: 0, peopleInserted: 0 });
 expect(fetch).not.toHaveBeenCalled();
});
it('worker and cron cannot fetch the same page concurrently', async () => {
 const { cache, fingerprint, prisma } = await setup();
 let release!: () => void;
 let entered!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 vi.mocked(fetch).mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return Response.json({ organic: [] }); });
 const worker = runPublicPoolJob(prisma, fingerprint, cache);
 await started;
 expect(await runPublicPoolStep(prisma, fingerprint, cache)).toEqual({ pagesProcessed: 0, peopleInserted: 0 });
 release(); await worker;
 expect(fetch).toHaveBeenCalledOnce();
});
it('rechecks completion after acquiring the provider lock', async () => {
 const { db, cache, fingerprint, prisma } = await setup();
 const original = cache.runWithProviderLock.bind(cache);
 vi.spyOn(cache, 'runWithProviderLock').mockImplementation(async (key, fn) => {
   Object.assign(db._state.discoverCache[0], { providerNextPage: 11 });
   return original(key, fn);
 });
 await runPublicPoolStep(prisma, fingerprint, cache);
 expect(fetch).not.toHaveBeenCalled();
 expect(pendingPublicPoolWhere()).toMatchObject({ providerNextPage: { lte: 10 }, resultCount: { lt: 100 }, providerExhausted: false });
});
it('persistent worker repeats the same bounded step until the last provider page', async () => {
 const { db, cache, fingerprint, prisma } = await setup();
 Object.assign(db._state.discoverCache[0], { providerNextPage: 9 });
 const starts: number[] = [];
 vi.mocked(fetch).mockImplementation(async (_url, options) => {
   const start = Number(new URL(JSON.parse(options!.body as string).url).searchParams.get('start'));
   starts.push(start);
   return Response.json({ organic: [{ title: 'Jane Doe - Software Engineer at Example | LinkedIn',
     link: `https://linkedin.com/in/person-${start}`, description: '' }] });
 });
 await runPublicPoolJob(prisma, fingerprint, cache);
 expect(starts).toEqual([80, 90]);
 expect(db._state.discoverCache[0]).toMatchObject({ providerNextPage: 11, resultCount: 12, providerExhausted: true });
});
it('aborted steps do not advance durable pagination', async () => {
 const { db, cache, fingerprint, prisma } = await setup();
 await expect(runPublicPoolStep(prisma, fingerprint, cache, { signal: AbortSignal.abort() })).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();
 expect(db._state.discoverCache[0]).toMatchObject({ providerNextPage: 2, resultCount: 10 });
});
