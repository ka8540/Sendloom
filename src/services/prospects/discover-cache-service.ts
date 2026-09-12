import { normalizeDiscoverPeopleWithEmails } from "@/services/prospects/discover-person-name-repair";
import { nameStateFields } from "@/services/prospects/discover-name-contract";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import {
  normalizeLinkedinCompanySlug,
  type DiscoverFingerprintInput
} from "@/services/prospects/discover-cache-fingerprint";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";
import type {
  EmailFormatDiscoveryDiagnostics,
  EmailFormatDiscoveryStatus
} from "@/services/prospects/email-domain-service";

const LOCK_KEY_PREFIX = "discover:shared-cache-lock";
const DEFAULT_LOCK_TTL_SECONDS = 120;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_FORMAT_FOUND_TTL_MS = 30 * DAY_MS;
const EMAIL_FORMAT_NO_EVIDENCE_TTL_MS = DAY_MS;

export const DISCOVER_CACHE_STATUS = {
  READY: "READY",
  REFRESHING: "REFRESHING",
  FAILED: "FAILED"
} as const;

export function resolveEmailFormatDiscoveryExpiry(
  status: EmailFormatDiscoveryStatus | "NOT_ATTEMPTED",
  checkedAt: Date
): Date | null {
  if (status === "FOUND") {
    return new Date(checkedAt.getTime() + EMAIL_FORMAT_FOUND_TTL_MS);
  }
  if (status === "NO_EVIDENCE") {
    return new Date(checkedAt.getTime() + EMAIL_FORMAT_NO_EVIDENCE_TTL_MS);
  }
  // Configuration, auth, rate-limit, network, provider, and parser failures
  // are intentionally not reusable negative cache results.
  return null;
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
  emailFormatDiscoveryStatus?: EmailFormatDiscoveryStatus | "NOT_ATTEMPTED";
  emailFormatDiscoveryReason?: string | null;
  emailFormatDiscoveryAt?: Date | string | null;
  emailFormatDiscoveryExpiresAt?: Date | string | null;
  diagnostics?: EmailFormatDiscoveryDiagnostics;
};

// One normalized public professional record. No requester identity is included.
export type ResolvedCachePerson = {
  sourceName?: string | null;
  nameNormalization?: string | null;
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

export type DiscoverCacheResult = {
  dataset: ResolvedDataset;
  source: "CACHE" | "PROVIDER";
  cacheId: string | null;
  fetchedAt: Date | null;
  /** True only when a PROVIDER run replaced a previously-existing (stale) entry. */
  refreshedStale: boolean;
  /** Which reusable database path won. Null means the paid provider ran. */
  cacheHitType?: "EXACT" | "COMPANY_POOL" | "LOCAL_PERSON" | null;
  /** Privacy-safe counts for cost-control observability. */
  lookupDiagnostics?: DiscoverCacheLookupDiagnostics;
};

export type DiscoverCacheLookupDiagnostics = {
  candidateEntryCount: number;
  candidatePersonCount: number;
  matchingPersonCount: number;
};

export type DiscoverCompanyPoolPersonFilter = (
  people: ResolvedCachePerson[]
) => Promise<ResolvedCachePerson[]> | ResolvedCachePerson[];

/**
 * A private, requester-owned database lookup performed only after both shared
 * cache paths miss. The dataset is returned to this request but is never copied
 * into the cross-user shared cache.
 */
export type DiscoverLocalPersonLookupResult = {
  dataset: ResolvedDataset | null;
  candidatePersonCount: number;
  matchingPersonCount: number;
};

export type DiscoverLocalPersonLookup = () => Promise<DiscoverLocalPersonLookupResult>;

export type LookupReusableDatasetParams = {
  fingerprint: string;
  fingerprintInput: DiscoverFingerprintInput;
  company: DiscoverCacheCompany;
  /**
   * Optional intent filter for the secondary same-company database lookup.
   * It is invoked only after the exact fingerprint fast path misses.
   */
  filterCompanyPoolPeople?: DiscoverCompanyPoolPersonFilter;
  /** Same-user ProspectPerson fallback, invoked after shared reuse. */
  lookupLocalPeople?: DiscoverLocalPersonLookup;
};

/** The narrow port the prospect-search service depends on (injectable for tests). */
export interface DiscoverCachePort {
  lookupReusableDataset(params: LookupReusableDatasetParams): Promise<DiscoverCacheResult>;
  updateEmailFormat?(params: UpdateCachedEmailFormatParams): Promise<void>;
}

export type UpdateCachedEmailFormatParams = {
  cacheId: string;
  format: ResolvedEmailFormat;
};

// Continuation state for an "Add 10 more" expansion: the entry's people (in
// stable provider order) plus where the provider left off.
export type DiscoverCacheExpansionState = {
  cacheId: string;
  providerNextPage: number;
  providerPagesFetched: number;
  providerExhausted: boolean;
  /** The shared evidence-backed email format stored on the entry. */
  emailFormat: ResolvedEmailFormat;
  people: ResolvedCachePerson[];
};

export type AppendProviderPeopleParams = {
  fingerprint: string;
  fingerprintInput: DiscoverFingerprintInput;
  company: DiscoverCacheCompany;
  emailFormat: ResolvedEmailFormat;
  /** Newly fetched normalized people for one or more continuation pages. */
  people: ResolvedCachePerson[];
  /** The next provider page to fetch after this append. */
  nextPage: number;
  /** Pages fetched in this expansion (added to the running total). */
  pagesFetched: number;
  /** Whether the provider confirmed it has no further pages / unique results. */
  exhausted: boolean;
};

/**
 * The cache surface a Discover expansion depends on. Kept separate from the
 * initial-search port so each can be injected/stubbed independently in tests.
 */
export interface DiscoverCacheExpansionPort {
  /** Current continuation state + cached people (sorted), or null if no entry. */
  getExpansionState(fingerprint: string): Promise<DiscoverCacheExpansionState | null>;
  /** Atomically append net-new cached people and advance continuation state. */
  appendProviderPeople(params: AppendProviderPeopleParams): Promise<DiscoverCacheExpansionState>;
  /** Persist provider exhaustion so future expansions stop calling the provider. */
  markProviderExhausted(fingerprint: string): Promise<void>;
  /**
   * Run `fn` while holding the per-fingerprint stampede lock so at most one
   * provider continuation runs for an identical canonical query at a time. The
   * caller must re-check `getExpansionState` inside `fn` (another holder may have
   * just appended results). Best-effort: if the lock cannot be acquired within
   * the wait window (a crashed holder), `fn` still runs and the lock TTL frees it.
   */
  runWithProviderLock<T>(fingerprint: string, fn: () => Promise<T>): Promise<T>;
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
  emailFormatDiscoveryStatus?: string | null;
  emailFormatDiscoveryReason?: string | null;
  emailFormatDiscoveryAt?: Date | string | null;
  emailFormatDiscoveryExpiresAt?: Date | string | null;
  cacheVersion?: string | null;
};

type CompanyPoolCacheRow = CacheRow & {
  companyKey: string;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
};

const EMPTY_LOOKUP_DIAGNOSTICS: DiscoverCacheLookupDiagnostics = {
  candidateEntryCount: 0,
  candidatePersonCount: 0,
  matchingPersonCount: 0
};

export type DiscoverSearchCacheServiceDeps = {
  prisma: PrismaClient;
  lock?: DiscoverCacheLock;
  now?: () => Date;
  ttlDays?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Deprecated test-construction compatibility; ordinary lookup never refreshes. */
  cleanupOnRefresh?: boolean;
};

/**
 * Shared, cross-user durable store for Discover provider results.
 *
 * - `lookupReusableDataset` only reads reusable people and can never call a
 *   provider. People do not expire merely because provider metadata is old.
 * - A cache stampede is prevented: only the lock owner runs the provider;
 *   that lock is reserved for explicit Add More continuation.
 * - Refreshes are atomic — old rows are replaced inside a transaction, so other
 *   users never observe an empty cache, and a failed refresh preserves the
 *   previous rows and never marks stale data fresh.
 */
export class DiscoverSearchCacheService implements DiscoverCachePort, DiscoverCacheExpansionPort {
  private readonly prisma: PrismaClient;
  private readonly lock: DiscoverCacheLock;
  private readonly now: () => Date;
  private readonly ttlDays: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(deps: DiscoverSearchCacheServiceDeps) {
    this.prisma = deps.prisma;
    this.lock = deps.lock ?? createRedisCacheLock();
    this.now = deps.now ?? (() => new Date());
    // Retained only for pruning abandoned empty refresh markers and for the
    // legacy test seeding helper. It never limits reuse of stored people.
    this.ttlDays = deps.ttlDays ?? 30;
    this.waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  private lockKey(fingerprint: string): string {
    return `${LOCK_KEY_PREFIX}:${fingerprint}`;
  }

  /**
   * Database-only people lookup used by every normal Discover search.
   *
   * The exact fingerprint, same-company pool, and requester-owned people are
   * checked in that order. Missing or empty database knowledge is represented
   * by `null`; it is never converted into permission to call Apify.
   */
  async lookupReusableDataset(params: LookupReusableDatasetParams): Promise<DiscoverCacheResult> {
    const exact = await this.getReusableDataset(
      params.fingerprint,
      params.fingerprintInput.cacheVersion
    );
    if (exact) {
      return {
        dataset: exact.dataset,
        source: "CACHE",
        cacheId: exact.id,
        fetchedAt: exact.fetchedAt,
        refreshedStale: false,
        cacheHitType: "EXACT",
        lookupDiagnostics: EMPTY_LOOKUP_DIAGNOSTICS
      };
    }

    const companyPool = await this.getReusableCompanyPoolDataset(params);
    if (companyPool.entry) {
      return this.companyPoolCacheResult(companyPool);
    }

    const localPeople = await this.getLocalPersonResult(params, companyPool.diagnostics);
    if (localPeople.result) {
      return localPeople.result;
    }
    return {
      dataset: { emailFormat: emptyResolvedEmailFormat(), people: [] },
      source: "CACHE",
      cacheId: null,
      fetchedAt: null,
      refreshedStale: false,
      cacheHitType: null,
      lookupDiagnostics: localPeople.diagnostics
    };
  }

  /** A reusable exact dataset. People age/status never disqualifies its rows. */
  async getReusableDataset(fingerprint: string, cacheVersion?: string): Promise<CachedEntry | null> {
    const entry = (await this.prisma.discoverSearchCache.findUnique({ where: { fingerprint } })) as CacheRow | null;
    if (!entry) {
      return null;
    }
    if (cacheVersion && entry.cacheVersion !== cacheVersion) {
      return null;
    }
    const peopleRows = await this.prisma.discoverSearchCachePerson.findMany({ where: { cacheId: entry.id } });
    if (peopleRows.length === 0) {
      return null;
    }
    const emailFormat = rowToEmailFormat(entry);
    return {
      id: entry.id,
      fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt) : null,
      dataset: {
        emailFormat,
        people: await normalizeDiscoverPeopleWithEmails(
          sortCachePeople(peopleRows as ResolvedCachePersonRow[]).map(cachePersonRowToResolved),
          emailFormat
        )
      }
    };
  }

  private companyPoolCacheResult(pool: CompanyPoolLookupResult): DiscoverCacheResult {
    const entry = pool.entry!;
    return {
      dataset: entry.dataset,
      source: "CACHE",
      cacheId: entry.id,
      fetchedAt: entry.fetchedAt,
      refreshedStale: false,
      cacheHitType: "COMPANY_POOL",
      lookupDiagnostics: pool.diagnostics
    };
  }

  private async getLocalPersonResult(
    params: LookupReusableDatasetParams,
    precedingDiagnostics: DiscoverCacheLookupDiagnostics
  ): Promise<{ result: DiscoverCacheResult | null; diagnostics: DiscoverCacheLookupDiagnostics }> {
    if (!params.lookupLocalPeople) {
      return { result: null, diagnostics: precedingDiagnostics };
    }

    const local = await params.lookupLocalPeople();
    const diagnostics = {
      candidateEntryCount: precedingDiagnostics.candidateEntryCount,
      candidatePersonCount:
        precedingDiagnostics.candidatePersonCount + Math.max(0, local.candidatePersonCount),
      matchingPersonCount:
        precedingDiagnostics.matchingPersonCount + Math.max(0, local.matchingPersonCount)
    };
    if (!local.dataset || local.dataset.people.length === 0) {
      return { result: null, diagnostics };
    }
    local.dataset.people = await normalizeDiscoverPeopleWithEmails(
      local.dataset.people,
      local.dataset.emailFormat
    );

    return {
      result: {
        dataset: local.dataset,
        source: "CACHE",
        cacheId: null,
        fetchedAt: null,
        refreshedStale: false,
        cacheHitType: "LOCAL_PERSON",
        lookupDiagnostics: diagnostics
      },
      diagnostics
    };
  }

  /**
   * Durable counterpart of the legacy freshness-gated pool lookup. This is the
   * path normal searches use, so neither `expiresAt` nor cache status can hide
   * people already stored under a strong canonical company identity.
   */
  private async getReusableCompanyPoolDataset(
    params: LookupReusableDatasetParams
  ): Promise<CompanyPoolLookupResult> {
    if (!params.filterCompanyPoolPeople) {
      return { entry: null, diagnostics: EMPTY_LOOKUP_DIAGNOSTICS };
    }

    const requestedIdentity = trustedCompanyIdentity({
      companyKey: params.fingerprintInput.companyKey,
      companyDomain: params.company.domain,
      companyLinkedinUrl: params.company.linkedinUrl
    });
    const identityPredicates = companyIdentityPredicates(requestedIdentity);
    if (identityPredicates.length === 0 || !identityIsInternallyConsistent(requestedIdentity)) {
      return { entry: null, diagnostics: EMPTY_LOOKUP_DIAGNOSTICS };
    }

    const rows = (await this.prisma.discoverSearchCache.findMany({
      where: {
        cacheVersion: params.fingerprintInput.cacheVersion,
        OR: identityPredicates
      }
    })) as CompanyPoolCacheRow[];
    const candidates = rows
      .filter((row) => sameTrustedCompany(requestedIdentity, trustedCompanyIdentity(row)))
      .sort((a, b) => cacheRowTime(b.fetchedAt) - cacheRowTime(a.fetchedAt) || a.id.localeCompare(b.id));

    if (candidates.length === 0) {
      return { entry: null, diagnostics: EMPTY_LOOKUP_DIAGNOSTICS };
    }

    const candidateOrder = new Map(candidates.map((entry, index) => [entry.id, index]));
    const peopleRows = (await this.prisma.discoverSearchCachePerson.findMany({
      where: { cacheId: { in: candidates.map((entry) => entry.id) } }
    })) as CompanyPoolPersonRow[];
    peopleRows.sort(
      (a, b) =>
        (candidateOrder.get(a.cacheId) ?? 0) - (candidateOrder.get(b.cacheId) ?? 0) ||
        (a.sortIndex ?? 0) - (b.sortIndex ?? 0)
    );

    const matching = await params.filterCompanyPoolPeople(peopleRows.map(cachePersonRowToResolved));
    const identities = new PersonIdentitySet();
    const deduped = matching.filter((person) => identities.addIfNew(person));
    const diagnostics = {
      candidateEntryCount: candidates.length,
      candidatePersonCount: peopleRows.length,
      matchingPersonCount: deduped.length
    };
    if (deduped.length === 0) {
      return { entry: null, diagnostics };
    }

    const firstMatch = new PersonIdentitySet([deduped[0]]);
    const sourceCacheId = peopleRows.find((person) => firstMatch.has(person))?.cacheId;
    const source = candidates.find((entry) => entry.id === sourceCacheId) ?? candidates[0];
    const dataset = { emailFormat: rowToEmailFormat(source), people: deduped };
    let derived: { id: string; fetchedAt: Date | null } = {
      id: source.id,
      fetchedAt: source.fetchedAt ? new Date(source.fetchedAt) : null
    };
    try {
      derived = await this.writeDerivedCompanyPoolDataset(params, dataset, [source]);
    } catch {
      // Reuse remains valid even when the optional exact-intent derivation fails.
    }
    return { entry: { id: derived.id, fetchedAt: derived.fetchedAt, dataset }, diagnostics };
  }

  /**
   * Materialize a company-pool hit under the current exact fingerprint. This
   * makes later identical requests use the fast path and gives Add 10 More a
   * correct continuation origin: page 1 has not been paid for on this exact
   * intent. Source freshness is copied conservatively and never extended.
   */
  private async writeDerivedCompanyPoolDataset(
    params: LookupReusableDatasetParams,
    dataset: ResolvedDataset,
    sources: CompanyPoolCacheRow[]
  ): Promise<{ id: string; fetchedAt: Date | null }> {
    dataset.people = await normalizeDiscoverPeopleWithEmails(dataset.people, dataset.emailFormat);
    const fetchedAtValues = sources
      .map((source) => (source.fetchedAt ? new Date(source.fetchedAt).getTime() : null))
      .filter((value): value is number => value !== null);
    const expiresAtValues = sources
      .map((source) => (source.expiresAt ? new Date(source.expiresAt).getTime() : null))
      .filter((value): value is number => value !== null);
    const fetchedAt = fetchedAtValues.length > 0 ? new Date(Math.min(...fetchedAtValues)) : null;
    const expiresAt = expiresAtValues.length > 0 ? new Date(Math.min(...expiresAtValues)) : null;
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
      // This exact role/location intent has not consumed a provider page. A
      // later explicit Add 10 More therefore starts at page 1.
      providerNextPage: 1,
      providerPagesFetched: 0,
      providerExhausted: false,
      lastProviderFetchAt: null,
      ...emailFormatColumns(dataset.emailFormat)
    };

    const id = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.discoverSearchCache.upsert({
        where: { fingerprint: params.fingerprint },
        create: { fingerprint: params.fingerprint, ...baseFields },
        update: baseFields
      });
      await tx.discoverSearchCachePerson.deleteMany({ where: { cacheId: entry.id } });
      let sortIndex = 0;
      for (const person of dataset.people) {
        await tx.discoverSearchCachePerson.create({ data: { cacheId: entry.id, sortIndex, ...person } });
        sortIndex += 1;
      }
      return entry.id;
    });
    return { id, fetchedAt };
  }

  /** Update only email-format state; never refetch or replace cached people. */
  async updateEmailFormat(params: UpdateCachedEmailFormatParams): Promise<void> {
    const checkedAt = params.format.emailFormatDiscoveryAt
      ? new Date(params.format.emailFormatDiscoveryAt)
      : this.now();
    const status = params.format.emailFormatDiscoveryStatus ?? "NOT_ATTEMPTED";
    const expiresAt =
      params.format.emailFormatDiscoveryExpiresAt !== undefined
        ? params.format.emailFormatDiscoveryExpiresAt
          ? new Date(params.format.emailFormatDiscoveryExpiresAt)
          : null
        : resolveEmailFormatDiscoveryExpiry(status, checkedAt);
    await this.prisma.discoverSearchCache.update({
      where: { id: params.cacheId },
      data: {
        ...emailFormatColumns(params.format),
        emailFormatDiscoveryStatus: status,
        emailFormatDiscoveryReason: params.format.emailFormatDiscoveryReason ?? null,
        emailFormatDiscoveryAt: checkedAt,
        emailFormatDiscoveryExpiresAt: expiresAt
      }
    });
  }

  // -- Expansion ("Add 10 more") continuation surface --------------------------

  async getExpansionState(fingerprint: string): Promise<DiscoverCacheExpansionState | null> {
    const entry = (await this.prisma.discoverSearchCache.findUnique({
      where: { fingerprint }
    })) as ContinuationRow | null;
    if (!entry) {
      return null;
    }
    const peopleRows = (await this.prisma.discoverSearchCachePerson.findMany({
      where: { cacheId: entry.id }
    })) as ResolvedCachePersonRow[];
    return {
      cacheId: entry.id,
      providerNextPage: entry.providerNextPage ?? 1,
      providerPagesFetched: entry.providerPagesFetched ?? 0,
      providerExhausted: Boolean(entry.providerExhausted),
      emailFormat: rowToEmailFormat(entry),
      people: await normalizeDiscoverPeopleWithEmails(sortCachePeople(peopleRows).map(cachePersonRowToResolved), rowToEmailFormat(entry))
    };
  }

  async appendProviderPeople(params: AppendProviderPeopleParams): Promise<DiscoverCacheExpansionState> {
    params = { ...params, people: await normalizeDiscoverPeopleWithEmails(params.people, params.emailFormat) };
    const now = this.now();
    const fp = params.fingerprintInput;
    return this.prisma.$transaction(async (tx) => {
      let entry = (await tx.discoverSearchCache.findUnique({
        where: { fingerprint: params.fingerprint }
      })) as ContinuationRow | null;
      if (!entry) {
        // Defensive: a continuation without a prior entry seeds one as READY so
        // the newly fetched people are still shared with other users.
        entry = (await tx.discoverSearchCache.upsert({
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
            status: DISCOVER_CACHE_STATUS.READY,
            fetchedAt: now,
            // Legacy column retained for migration compatibility. People do not expire.
            expiresAt: null,
            resultCount: 0,
            ...emailFormatColumns(params.emailFormat)
          },
          update: {}
        })) as ContinuationRow;
      }

      const existing = (await tx.discoverSearchCachePerson.findMany({
        where: { cacheId: entry.id }
      })) as ResolvedCachePersonRow[];
      // Dedupe by every stable provider identity. A provider can occasionally
      // issue a replacement source id for the same LinkedIn profile; sharing a
      // normalized profile URL still makes that a true duplicate. Names, titles,
      // and company are deliberately never identity keys.
      const existingIdentities = new PersonIdentitySet(existing);
      let sortIndex = existing.reduce((max, row) => Math.max(max, (row.sortIndex ?? 0) + 1), 0);
      let appended = 0;
      for (const person of params.people) {
        if (!existingIdentities.addIfNew(person)) {
          continue;
        }
        await tx.discoverSearchCachePerson.create({ data: { cacheId: entry.id, sortIndex, ...person } });
        sortIndex += 1;
        appended += 1;
      }

      const pagesFetched = (entry.providerPagesFetched ?? 0) + params.pagesFetched;
      await tx.discoverSearchCache.update({
        where: { id: entry.id },
        data: {
          resultCount: existing.length + appended,
          providerNextPage: params.nextPage,
          providerPagesFetched: pagesFetched,
          providerExhausted: params.exhausted,
          lastProviderFetchAt: now,
          status: DISCOVER_CACHE_STATUS.READY
        }
      });

      const allRows = (await tx.discoverSearchCachePerson.findMany({
        where: { cacheId: entry.id }
      })) as ResolvedCachePersonRow[];
      return {
        cacheId: entry.id,
        providerNextPage: params.nextPage,
        providerPagesFetched: pagesFetched,
        providerExhausted: params.exhausted,
        emailFormat: rowToEmailFormat(entry),
        people: sortCachePeople(allRows).map(cachePersonRowToResolved)
      };
    });
  }

  async markProviderExhausted(fingerprint: string): Promise<void> {
    try {
      await this.prisma.discoverSearchCache.update({
        where: { fingerprint },
        data: { providerExhausted: true, lastProviderFetchAt: this.now() }
      });
    } catch {
      // Best effort: a follow-up expansion re-detects exhaustion if this fails.
    }
  }

  async runWithProviderLock<T>(fingerprint: string, fn: () => Promise<T>): Promise<T> {
    const key = this.lockKey(fingerprint);
    const deadline = this.now().getTime() + this.waitTimeoutMs;
    let token = await this.lock.acquire(key);
    while (!token && this.now().getTime() < deadline) {
      await delay(this.pollIntervalMs);
      token = await this.lock.acquire(key);
    }
    try {
      return await fn();
    } finally {
      if (token) {
        await this.lock.release(key, token);
      }
    }
  }

  /**
   * Remove only old, empty transient rows. Reusable people are durable database
   * knowledge and are never deleted because `expiresAt` passed. This keeps
   * cleanup useful for abandoned REFRESHING/FAILED placeholders without
   * discarding provider data we paid to acquire.
   */
  async cleanupExpired(now: Date = this.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.ttlDays * DAY_MS);
    const candidates = (await this.prisma.discoverSearchCache.findMany({
      where: { resultCount: 0 }
    })) as Array<{
      id: string;
      status?: string | null;
      refreshStartedAt?: Date | string | null;
      updatedAt?: Date | string | null;
      expiresAt?: Date | string | null;
    }>;
    let removed = 0;
    for (const entry of candidates) {
      if (entry.status !== DISCOVER_CACHE_STATUS.FAILED && entry.status !== DISCOVER_CACHE_STATUS.REFRESHING) {
        continue;
      }
      const transientAt = entry.refreshStartedAt ?? entry.updatedAt ?? entry.expiresAt;
      if (!transientAt || new Date(transientAt).getTime() >= cutoff.getTime()) {
        continue;
      }
      const people = await this.prisma.discoverSearchCachePerson.findMany({ where: { cacheId: entry.id } });
      if (people.length > 0) {
        continue;
      }
      await this.prisma.discoverSearchCache.delete({ where: { id: entry.id } });
      removed += 1;
    }
    return removed;
  }
}

// A continuation read includes the provider-pagination columns the expansion
// surface needs (the base CacheRow only carries the email-format fields).
type ContinuationRow = CacheRow & {
  providerNextPage?: number | null;
  providerPagesFetched?: number | null;
  providerExhausted?: boolean | null;
};

type ResolvedCachePersonRow = ResolvedCachePerson & { positionCategory: string | null; sortIndex?: number | null };
type CompanyPoolPersonRow = ResolvedCachePersonRow & { cacheId: string };
type CompanyPoolLookupResult = {
  entry: CachedEntry | null;
  diagnostics: DiscoverCacheLookupDiagnostics;
};

type TrustedCompanyIdentity = {
  domains: Set<string>;
  linkedinSlugs: Set<string>;
};

function trustedCompanyIdentity(input: {
  companyKey?: string | null;
  companyDomain?: string | null;
  companyLinkedinUrl?: string | null;
}): TrustedCompanyIdentity {
  const domains = new Set<string>();
  const linkedinSlugs = new Set<string>();
  const domain = normalizeDomain(input.companyDomain);
  if (domain) {
    domains.add(domain);
  }
  const slug = normalizeLinkedinCompanySlug(input.companyLinkedinUrl);
  if (slug) {
    linkedinSlugs.add(slug);
  }
  if (input.companyKey?.startsWith("domain:")) {
    const keyDomain = normalizeDomain(input.companyKey.slice("domain:".length));
    if (keyDomain) {
      domains.add(keyDomain);
    }
  }
  if (input.companyKey?.startsWith("linkedin:")) {
    const keySlug = input.companyKey.slice("linkedin:".length).trim().toLowerCase();
    if (keySlug) {
      linkedinSlugs.add(keySlug);
    }
  }
  return { domains, linkedinSlugs };
}

function identityIsInternallyConsistent(identity: TrustedCompanyIdentity): boolean {
  return identity.domains.size <= 1 && identity.linkedinSlugs.size <= 1;
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function sameTrustedCompany(left: TrustedCompanyIdentity, right: TrustedCompanyIdentity): boolean {
  if (!identityIsInternallyConsistent(right)) {
    return false;
  }
  if (left.domains.size > 0 && right.domains.size > 0 && !setsIntersect(left.domains, right.domains)) {
    return false;
  }
  if (
    left.linkedinSlugs.size > 0 &&
    right.linkedinSlugs.size > 0 &&
    !setsIntersect(left.linkedinSlugs, right.linkedinSlugs)
  ) {
    return false;
  }
  return setsIntersect(left.domains, right.domains) || setsIntersect(left.linkedinSlugs, right.linkedinSlugs);
}

function companyIdentityPredicates(identity: TrustedCompanyIdentity): Array<Record<string, unknown>> {
  const predicates: Array<Record<string, unknown>> = [];
  for (const domain of identity.domains) {
    predicates.push({ companyKey: `domain:${domain}` });
    predicates.push({ companyDomain: { equals: domain, mode: "insensitive" } });
  }
  for (const slug of identity.linkedinSlugs) {
    predicates.push({ companyKey: `linkedin:${slug}` });
    for (const kind of ["company", "school", "showcase"]) {
      predicates.push({ companyLinkedinUrl: { contains: `/${kind}/${slug}`, mode: "insensitive" } });
    }
  }
  return predicates;
}

function cacheRowTime(value: Date | string | null): number {
  return value ? new Date(value).getTime() : 0;
}

/** Order cached people by their stable provider sort index (then insertion). */
function sortCachePeople<T extends { sortIndex?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
}

/** Map one cache-person row to the shared normalized shape. */
function cachePersonRowToResolved(row: ResolvedCachePersonRow): ResolvedCachePerson {
  return {
    sourceProfileId: row.sourceProfileId,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    ...nameStateFields(row),
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
  };
}

function rowToEmailFormat(entry: CacheRow): ResolvedEmailFormat {
  return {
    emailDomain: entry.emailDomain,
    emailDomainConfidence: entry.emailDomainConfidence,
    emailDomainEvidence: entry.emailDomainEvidence ?? null,
    emailPattern: entry.emailPattern,
    patternConfidence: entry.patternConfidence,
    patternEvidence: entry.patternEvidence ?? null,
    emailFormatReason: entry.emailFormatReason,
    emailFormatDiscoveryStatus:
      (entry.emailFormatDiscoveryStatus as EmailFormatDiscoveryStatus | "NOT_ATTEMPTED" | null) ?? "NOT_ATTEMPTED",
    emailFormatDiscoveryReason: entry.emailFormatDiscoveryReason ?? null,
    emailFormatDiscoveryAt: entry.emailFormatDiscoveryAt ? new Date(entry.emailFormatDiscoveryAt) : null,
    emailFormatDiscoveryExpiresAt: entry.emailFormatDiscoveryExpiresAt
      ? new Date(entry.emailFormatDiscoveryExpiresAt)
      : null
  };
}

function emptyResolvedEmailFormat(): ResolvedEmailFormat {
  return {
    emailDomain: null,
    emailDomainConfidence: "UNAVAILABLE",
    emailDomainEvidence: null,
    emailPattern: null,
    patternConfidence: "UNAVAILABLE",
    patternEvidence: null,
    emailFormatReason: null,
    emailFormatDiscoveryStatus: "NOT_ATTEMPTED",
    emailFormatDiscoveryReason: null,
    emailFormatDiscoveryAt: null,
    emailFormatDiscoveryExpiresAt: null
  };
}

function rowToDataset(entry: CacheRow, peopleRows: ResolvedCachePersonRow[]): ResolvedDataset {
  return {
    emailFormat: rowToEmailFormat(entry),
    people: sortCachePeople(peopleRows).map(cachePersonRowToResolved)
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
    emailFormatReason: format.emailFormatReason,
    emailFormatDiscoveryStatus: format.emailFormatDiscoveryStatus ?? "NOT_ATTEMPTED",
    emailFormatDiscoveryReason: format.emailFormatDiscoveryReason ?? null,
    emailFormatDiscoveryAt: format.emailFormatDiscoveryAt ? new Date(format.emailFormatDiscoveryAt) : null,
    emailFormatDiscoveryExpiresAt: format.emailFormatDiscoveryExpiresAt
      ? new Date(format.emailFormatDiscoveryExpiresAt)
      : null
  };
}
