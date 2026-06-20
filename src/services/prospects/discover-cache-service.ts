import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import type { DiscoverFingerprintInput } from "@/services/prospects/discover-cache-fingerprint";

const LOCK_KEY_PREFIX = "discover:shared-cache-lock";
const DEFAULT_LOCK_TTL_SECONDS = 120;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DISCOVER_CACHE_STATUS = {
  READY: "READY",
  REFRESHING: "REFRESHING",
  FAILED: "FAILED"
} as const;

/** Effective shared-cache TTL in days (env override, defaulting to 30). */
export function resolveSharedCacheTtlDays(): number {
  const configured = env.DISCOVER_SHARED_CACHE_TTL_DAYS;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : 30;
}

/** Effective cache schema version (part of the fingerprint). */
export function resolveSharedCacheVersion(): string {
  return env.DISCOVER_SHARED_CACHE_VERSION || "v1";
}

// Normalized, evidence-backed company email format that is safe to share. A
// per-user manual override is never written into the shared cache.
export type ResolvedEmailFormat = {
  emailDomain: string | null;
  emailDomainConfidence: string;
  emailDomainEvidence: unknown;
  emailPattern: string | null;
  patternConfidence: string;
  patternEvidence: unknown;
  emailFormatReason: string | null;
};

// One normalized public professional record. No requester identity is included.
export type ResolvedCachePerson = {
  sourceProfileId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  currentTitle: string | null;
  normalizedTitle: string | null;
  positionCategory: string;
  location: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  linkedinUrl: string;
  inferredEmail: string | null;
  emailStatus: string;
  emailConfidence: string;
  emailPattern: string | null;
  emailSource: string | null;
};

export type ResolvedDataset = {
  emailFormat: ResolvedEmailFormat;
  people: ResolvedCachePerson[];
};

export type CachedEntry = {
  id: string;
  fetchedAt: Date | null;
  dataset: ResolvedDataset;
};

export type DiscoverCacheCompany = {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
};

export type DiscoverProviderRun = () => Promise<ResolvedDataset>;

export type DiscoverCacheResult = {
  dataset: ResolvedDataset;
  source: "CACHE" | "PROVIDER";
  cacheId: string | null;
  fetchedAt: Date | null;
  /** True only when a PROVIDER run replaced a previously-existing (stale) entry. */
  refreshedStale: boolean;
};

export type GetOrRefreshParams = {
  fingerprint: string;
  fingerprintInput: DiscoverFingerprintInput;
  company: DiscoverCacheCompany;
  provider: DiscoverProviderRun;
};

/** The narrow port the prospect-search service depends on (injectable for tests). */
export interface DiscoverCachePort {
  getOrRefresh(params: GetOrRefreshParams): Promise<DiscoverCacheResult>;
}

// A short-lived, owner-token lock. Only the owner may release it, and it always
// expires so a crashed worker can never block future refreshes permanently.
export interface DiscoverCacheLock {
  acquire(key: string): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

export function createRedisCacheLock(ttlSeconds = DEFAULT_LOCK_TTL_SECONDS): DiscoverCacheLock {
  return {
    async acquire(key: string): Promise<string | null> {
      const token = `${Date.now()}:${randomUUID()}`;
      const result = await getRedis().set(key, token, "EX", ttlSeconds, "NX");
      return result === "OK" ? token : null;
    },
    async release(key: string, token: string): Promise<void> {
      try {
        await getRedis().eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token
        );
      } catch {
        // Best effort: the lock's TTL guarantees eventual release.
      }
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CacheRow = {
  id: string;
  status: string;
  fetchedAt: Date | string | null;
  expiresAt: Date | string | null;
  emailDomain: string | null;
  emailDomainConfidence: string;
  emailDomainEvidence: unknown;
  emailPattern: string | null;
  patternConfidence: string;
  patternEvidence: unknown;
  emailFormatReason: string | null;
};

export type DiscoverSearchCacheServiceDeps = {
  prisma: PrismaClient;
  lock?: DiscoverCacheLock;
  now?: () => Date;
  ttlDays?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  cleanupOnRefresh?: boolean;
};

/**
 * Shared, cross-user 30-day cache for Discover provider results.
 *
 * - `getOrRefresh` returns a fresh cached dataset without calling the provider,
 *   or runs the provider behind an atomic lock and stores the result.
 * - A cache stampede is prevented: only the lock owner runs the provider;
 *   concurrent callers poll (bounded) for the entry to become READY and reuse it.
 * - Refreshes are atomic — old rows are replaced inside a transaction, so other
 *   users never observe an empty cache, and a failed refresh preserves the
 *   previous rows and never marks stale data fresh.
 */
export class DiscoverSearchCacheService implements DiscoverCachePort {
  private readonly prisma: PrismaClient;
  private readonly lock: DiscoverCacheLock;
  private readonly now: () => Date;
  private readonly ttlDays: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly cleanupOnRefresh: boolean;

  constructor(deps: DiscoverSearchCacheServiceDeps) {
    this.prisma = deps.prisma;
    this.lock = deps.lock ?? createRedisCacheLock();
    this.now = deps.now ?? (() => new Date());
    this.ttlDays = deps.ttlDays ?? resolveSharedCacheTtlDays();
    this.waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.cleanupOnRefresh = deps.cleanupOnRefresh ?? true;
  }

  private lockKey(fingerprint: string): string {
    return `${LOCK_KEY_PREFIX}:${fingerprint}`;
  }

  /** A fresh, READY, unexpired dataset for this fingerprint, or null. */
  async getFreshDataset(fingerprint: string, now: Date = this.now()): Promise<CachedEntry | null> {
    const entry = (await this.prisma.discoverSearchCache.findUnique({ where: { fingerprint } })) as CacheRow | null;
    if (!entry || entry.status !== DISCOVER_CACHE_STATUS.READY || !entry.expiresAt) {
      return null;
    }
    if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
      return null;
    }
    const peopleRows = await this.prisma.discoverSearchCachePerson.findMany({ where: { cacheId: entry.id } });
    return {
      id: entry.id,
      fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt) : null,
      dataset: rowToDataset(entry, peopleRows as ResolvedCachePersonRow[])
    };
  }

  async getOrRefresh(params: GetOrRefreshParams): Promise<DiscoverCacheResult> {
    // Fast path: a fresh shared dataset is reused without any provider call.
    const fresh = await this.getFreshDataset(params.fingerprint, this.now());
    if (fresh) {
      return { dataset: fresh.dataset, source: "CACHE", cacheId: fresh.id, fetchedAt: fresh.fetchedAt, refreshedStale: false };
    }

    const key = this.lockKey(params.fingerprint);
    const token = await this.lock.acquire(key);

    if (token) {
      try {
        // Re-check under the lock: a concurrent holder may have just refreshed.
        const refreshed = await this.getFreshDataset(params.fingerprint, this.now());
        if (refreshed) {
          return {
            dataset: refreshed.dataset,
            source: "CACHE",
            cacheId: refreshed.id,
            fetchedAt: refreshed.fetchedAt,
            refreshedStale: false
          };
        }
        const existing = (await this.prisma.discoverSearchCache.findUnique({
          where: { fingerprint: params.fingerprint }
        })) as { id: string } | null;
        return await this.runProviderAndStore(params, Boolean(existing));
      } finally {
        await this.lock.release(key, token);
      }
    }

    // Another request holds the lock — wait (bounded) for it to populate.
    const waited = await this.pollForFresh(params.fingerprint);
    if (waited) {
      return { dataset: waited.dataset, source: "CACHE", cacheId: waited.id, fetchedAt: waited.fetchedAt, refreshedStale: false };
    }

    // The holder did not finish in time (likely crashed; the lock TTL will free
    // it). Fall back to running the provider ourselves so the request never
    // hangs, writing the cache best-effort.
    return await this.runProviderAndStore(params, false);
  }

  private async runProviderAndStore(params: GetOrRefreshParams, refreshedStale: boolean): Promise<DiscoverCacheResult> {
    let dataset: ResolvedDataset;
    try {
      dataset = await params.provider();
    } catch (error) {
      // Preserve any previous rows; never mark stale data fresh.
      await this.markRefreshFailed(params, safeErrorCode(error));
      throw error;
    }

    const written = await this.writeFreshDataset(params, dataset);
    if (this.cleanupOnRefresh) {
      await this.cleanupExpired().catch(() => undefined);
    }
    return { dataset, source: "PROVIDER", cacheId: written.id, fetchedAt: written.fetchedAt, refreshedStale };
  }

  private async writeFreshDataset(
    params: GetOrRefreshParams,
    dataset: ResolvedDataset
  ): Promise<{ id: string; fetchedAt: Date }> {
    const fetchedAt = this.now();
    const expiresAt = new Date(fetchedAt.getTime() + this.ttlDays * DAY_MS);
    const fp = params.fingerprintInput;
    const baseFields = {
      cacheVersion: fp.cacheVersion,
      companyKey: fp.companyKey,
      companyName: params.company.name,
      companyDomain: params.company.domain,
      companyLinkedinUrl: params.company.linkedinUrl,
      normalizedRoles: fp.roles,
      normalizedLocations: fp.locations,
      resultLimit: fp.resultLimit,
      status: DISCOVER_CACHE_STATUS.READY,
      fetchedAt,
      expiresAt,
      refreshStartedAt: null,
      lastErrorCode: null,
      resultCount: dataset.people.length,
      ...emailFormatColumns(dataset.emailFormat)
    };

    const id = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.discoverSearchCache.upsert({
        where: { fingerprint: params.fingerprint },
        create: { fingerprint: params.fingerprint, ...baseFields },
        update: baseFields
      });
      // Replace people atomically: old rows are removed and new rows inserted in
      // the same transaction so a concurrent reader never sees an empty cache.
      await tx.discoverSearchCachePerson.deleteMany({ where: { cacheId: entry.id } });
      for (const person of dataset.people) {
        await tx.discoverSearchCachePerson.create({ data: { cacheId: entry.id, ...person } });
      }
      return entry.id;
    });

    return { id, fetchedAt };
  }

  private async markRefreshFailed(params: GetOrRefreshParams, errorCode: string): Promise<void> {
    const fp = params.fingerprintInput;
    try {
      await this.prisma.discoverSearchCache.upsert({
        where: { fingerprint: params.fingerprint },
        create: {
          fingerprint: params.fingerprint,
          cacheVersion: fp.cacheVersion,
          companyKey: fp.companyKey,
          companyName: params.company.name,
          companyDomain: params.company.domain,
          companyLinkedinUrl: params.company.linkedinUrl,
          normalizedRoles: fp.roles,
          normalizedLocations: fp.locations,
          resultLimit: fp.resultLimit,
          status: DISCOVER_CACHE_STATUS.FAILED,
          lastErrorCode: errorCode,
          refreshStartedAt: null,
          resultCount: 0
        },
        // Existing entry: only flag the failure. People, fetchedAt, and
        // expiresAt are intentionally untouched so previous rows are preserved.
        update: { status: DISCOVER_CACHE_STATUS.FAILED, lastErrorCode: errorCode, refreshStartedAt: null }
      });
    } catch {
      // Recording the failure is best-effort; the user's search still fails.
    }
  }

  /** Wait (bounded) for another holder to publish a READY dataset. */
  private async pollForFresh(fingerprint: string): Promise<CachedEntry | null> {
    const deadline = this.now().getTime() + this.waitTimeoutMs;
    while (this.now().getTime() < deadline) {
      await delay(this.pollIntervalMs);
      const fresh = await this.getFreshDataset(fingerprint, this.now());
      if (fresh) {
        return fresh;
      }
    }
    return null;
  }

  /**
   * Delete cache entries that expired more than one TTL ago (abandoned/failed
   * leftovers). Cascade removes their people rows. Safe to call opportunistically
   * or from a scheduled job; never touches user-owned records.
   */
  async cleanupExpired(now: Date = this.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.ttlDays * DAY_MS);
    const abandoned = (await this.prisma.discoverSearchCache.findMany({
      where: { expiresAt: { lt: cutoff } }
    })) as Array<{ id: string }>;
    let removed = 0;
    for (const entry of abandoned) {
      await this.prisma.discoverSearchCachePerson.deleteMany({ where: { cacheId: entry.id } });
      await this.prisma.discoverSearchCache.delete({ where: { id: entry.id } });
      removed += 1;
    }
    return removed;
  }
}

type ResolvedCachePersonRow = ResolvedCachePerson & { positionCategory: string | null };

function rowToDataset(entry: CacheRow, peopleRows: ResolvedCachePersonRow[]): ResolvedDataset {
  return {
    emailFormat: {
      emailDomain: entry.emailDomain,
      emailDomainConfidence: entry.emailDomainConfidence,
      emailDomainEvidence: entry.emailDomainEvidence ?? null,
      emailPattern: entry.emailPattern,
      patternConfidence: entry.patternConfidence,
      patternEvidence: entry.patternEvidence ?? null,
      emailFormatReason: entry.emailFormatReason
    },
    people: peopleRows.map((row) => ({
      sourceProfileId: row.sourceProfileId,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      currentTitle: row.currentTitle,
      normalizedTitle: row.normalizedTitle,
      positionCategory: row.positionCategory ?? "OTHER",
      location: row.location,
      country: row.country,
      state: row.state,
      city: row.city,
      linkedinUrl: row.linkedinUrl,
      inferredEmail: row.inferredEmail,
      emailStatus: row.emailStatus,
      emailConfidence: row.emailConfidence,
      emailPattern: row.emailPattern,
      emailSource: row.emailSource
    }))
  };
}

function emailFormatColumns(format: ResolvedEmailFormat) {
  return {
    emailDomain: format.emailDomain,
    emailDomainConfidence: format.emailDomainConfidence,
    emailDomainEvidence: (format.emailDomainEvidence ?? null) as never,
    emailPattern: format.emailPattern,
    patternConfidence: format.patternConfidence,
    patternEvidence: (format.patternEvidence ?? null) as never,
    emailFormatReason: format.emailFormatReason
  };
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_]{1,64}$/.test(code)) {
      return code;
    }
  }
  return "PROVIDER_ERROR";
}
