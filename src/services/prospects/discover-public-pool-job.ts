import type { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';
import { queues } from '@/lib/queue';
import { DiscoverSearchCacheService } from './discover-cache-service';
import { publicPoolPageProvider } from './public-pool-page';

export async function enqueuePublicPool(fingerprint: string): Promise<void> {
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search') return;
  await queues.discover.add('fill-public-pool', { fingerprint }, {
    jobId: `public-pool-${fingerprint}`, attempts: 5, backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true, removeOnFail: true
  });
}
/** Durable BullMQ execution; no user allocation, quota or manual format enters this job. */
export async function runPublicPoolJob(prisma: PrismaClient, fingerprint: string, cache = new DiscoverSearchCacheService({ prisma })): Promise<void> {
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search') return;
  const entry = await prisma.discoverSearchCache.findUnique({ where: { fingerprint } });
  if (!entry || !entry.expiresAt || entry.expiresAt <= new Date() || entry.providerExhausted) return;
  const state = await cache.getExpansionState(fingerprint);
  if (!state) return;
  const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const roles = strings(entry.normalizedRoles), locations = strings(entry.normalizedLocations);
  const company = { name: entry.companyName, domain: entry.companyDomain, linkedinUrl: entry.companyLinkedinUrl };
  await cache.fillPublicPool({ fingerprint, company, fingerprintInput: { companyKey: entry.companyKey,
    roles, locations, resultLimit: entry.resultLimit, cacheVersion: entry.cacheVersion },
    onPublicPageCommitted: progress => console.info('[discover-background]', progress),
    minimumPeople: env.DISCOVER_PUBLIC_MAX_RESULTS, provider: async () => { throw new Error('Invalid provider path.'); },
    progressiveProvider: publicPoolPageProvider({ prisma, company, roles, locations, emailFormat: state.emailFormat }) });
}

/** Scheduler recovery also covers a request dying between its DB commit and enqueue. */
export async function enqueuePendingPublicPools(prisma: PrismaClient): Promise<void> {
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search') return;
  const pending = await prisma.discoverSearchCache.findMany({ where: { providerExhausted: false,
    expiresAt: { gt: new Date() }, publicExpansion: { path: ['provider'], equals: 'brightdata_google' } },
    select: { fingerprint: true }, orderBy: { lastProviderFetchAt: 'asc' }, take: 20 });
  for (const entry of pending) await enqueuePublicPool(entry.fingerprint);
}
