import type { PrismaClient, Prisma, DiscoverSearchCache } from '@prisma/client';
import { env } from '@/lib/env';
import { queues } from '@/lib/queue';
import { DiscoverSearchCacheService, DiscoverProviderBusyError } from './discover-cache-service';
import { publicPoolPageProvider } from './public-pool-page';

export async function enqueuePublicPool(fingerprint: string): Promise<void> {
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search') return;
  await queues.discover.add('fill-public-pool', { fingerprint }, {
    jobId: `public-pool-${fingerprint}`, attempts: 5, backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true, removeOnFail: true
  });
}
/** Both the persistent worker and external cron consume this single-page implementation. */
export async function runPublicPoolStep(prisma: PrismaClient, fingerprint: string,
  cache = new DiscoverSearchCacheService({ prisma, waitTimeoutMs: 0 }),
  options: { signal?: AbortSignal; logPrefix?: string } = {}) {
  const prefix = options.logPrefix ?? '[discover-background]';
  const started = Date.now();
  const outcome = { pagesProcessed: 0, peopleInserted: 0 };
  if (!publicExpansionEnabled()) return outcome;
  const entry = await prisma.discoverSearchCache.findUnique({ where: { fingerprint } });
  if (!entry || !isPendingPublicPool(entry)) {
    console.info(prefix, { event: 'CACHE_COMPLETE', cacheId: entry?.id });
    return outcome;
  }
  const state = await cache.getExpansionState(fingerprint);
  if (!state) return outcome;
  const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const roles = strings(entry.normalizedRoles), locations = strings(entry.normalizedLocations);
  const company = { name: entry.companyName, domain: entry.companyDomain, linkedinUrl: entry.companyLinkedinUrl };
  const provider = publicPoolPageProvider({ prisma, company, roles, locations, emailFormat: state.emailFormat, signal: options.signal });
  try {
    await cache.fillPublicPool({ fingerprint, company, fingerprintInput: { companyKey: entry.companyKey,
      roles, locations, resultLimit: entry.resultLimit, cacheVersion: entry.cacheVersion },
      publicPageLimit: 1,
      beforePublicPage: async () => {
        options.signal?.throwIfAborted();
        const fresh = await prisma.discoverSearchCache.findUnique({ where: { fingerprint } });
        // A competing consumer may have completed this exact page after our scan.
        return !!fresh && isPendingPublicPool(fresh) && fresh.providerNextPage === entry.providerNextPage;
      },
      onPublicPageCommitted: progress => {
        outcome.pagesProcessed = 1;
        outcome.peopleInserted = progress.stored;
        console.info(prefix, { event: 'PAGE_COMPLETE', cacheId: entry.id, companyName: entry.companyName,
          providerPage: progress.page, previousResultCount: entry.resultCount,
          newResultCount: entry.resultCount + progress.stored, insertedCount: progress.stored,
          providerNextPage: progress.page + 1, exhausted: progress.exhausted, durationMs: Date.now() - started });
        if (progress.exhausted || progress.page >= env.DISCOVER_PUBLIC_MAX_PAGES || progress.poolSize >= env.DISCOVER_PUBLIC_MAX_RESULTS)
          console.info(prefix, { event: 'CACHE_COMPLETE', cacheId: entry.id });
      },
      minimumPeople: env.DISCOVER_PUBLIC_MAX_RESULTS, provider: async () => { throw new Error('Invalid provider path.'); },
      progressiveProvider: async current => {
        const page = await provider(current);
        options.signal?.throwIfAborted();
        return page;
      } });
  } catch (error) {
    if (!(error instanceof DiscoverProviderBusyError)) {
      console.error(prefix, { event: 'ERROR', cacheId: entry.id, companyName: entry.companyName,
        providerPage: entry.providerNextPage, durationMs: Date.now() - started });
      throw error;
    }
    console.info(prefix, { event: 'LOCK_NOT_ACQUIRED', cacheId: entry.id });
  }
  return outcome;
}

export function publicExpansionEnabled() {
  return env.WEB_SEARCH_PROVIDER === 'brightdata_google' && env.DISCOVER_PEOPLE_PROVIDER === 'public_search';
}

export function pendingPublicPoolWhere(): Prisma.DiscoverSearchCacheWhereInput {
  return { providerExhausted: false, providerNextPage: { lte: env.DISCOVER_PUBLIC_MAX_PAGES },
    resultCount: { lt: env.DISCOVER_PUBLIC_MAX_RESULTS }, expiresAt: { gt: new Date() },
    publicExpansion: { path: ['provider'], equals: 'brightdata_google' } };
}

export function isPendingPublicPool(entry: DiscoverSearchCache): boolean {
  const expansion = entry.publicExpansion as { provider?: string } | null;
  return !entry.providerExhausted && entry.providerNextPage <= env.DISCOVER_PUBLIC_MAX_PAGES
    && entry.resultCount < env.DISCOVER_PUBLIC_MAX_RESULTS && !!entry.expiresAt && entry.expiresAt > new Date()
    && expansion?.provider === 'brightdata_google';
}

/** Persistent consumers keep filling, releasing the shared lease after each page. */
export async function runPublicPoolJob(prisma: PrismaClient, fingerprint: string, cache = new DiscoverSearchCacheService({ prisma })) {
  for (let page = 0; page < env.DISCOVER_PUBLIC_MAX_PAGES; page++) {
    const result = await runPublicPoolStep(prisma, fingerprint, cache);
    if (!result.pagesProcessed) return;
  }
}

/** Scheduler recovery also covers a request dying between its DB commit and enqueue. */
export async function enqueuePendingPublicPools(prisma: PrismaClient): Promise<void> {
  if (env.WEB_SEARCH_PROVIDER !== 'brightdata_google' || env.DISCOVER_PEOPLE_PROVIDER !== 'public_search') return;
  const pending = await prisma.discoverSearchCache.findMany({ where: pendingPublicPoolWhere(),
    select: { fingerprint: true }, orderBy: { lastProviderFetchAt: 'asc' }, take: 20 });
  for (const entry of pending) await enqueuePublicPool(entry.fingerprint);
}
