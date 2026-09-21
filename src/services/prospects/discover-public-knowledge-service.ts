import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import {
  createRedisCacheLock,
  type AppendProviderPeopleParams,
  type DiscoverCacheCompany,
  type DiscoverCacheExpansionPort,
  type DiscoverCacheExpansionState,
  type DiscoverCacheLock,
  type DiscoverCacheLookupDiagnostics,
  type DiscoverCachePort,
  type DiscoverCacheResult,
  type DiscoverCompanyPoolSource,
  type LookupReusableDatasetParams,
  type ResolvedCachePerson,
  type ResolvedDataset,
  type ResolvedEmailFormat,
  type UpdateCachedEmailFormatParams
} from "@/services/prospects/discover-cache-service";
import {
  normalizeLinkedinCompanySlug,
  sameNormalizedIntent
} from "@/services/prospects/discover-cache-fingerprint";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

const RESULT_KEY_PREFIX = "discover:people";
const COMPANY_VERSION_KEY_PREFIX = "discover:company-version";
const LOCK_KEY_PREFIX = "discover:public-provider-lock";
const DEFAULT_RESULT_TTL_SECONDS = 15 * 60;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

type RedisResultClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
};

type PublicPersonRow = ResolvedCachePerson & {
  id: string;
  companyCanonicalKey: string;
  companyDomain: string | null;
  companyLinkedinSlug: string | null;
  normalizedLinkedinUrl?: string | null;
  positionCategory: string | null;
};

type ProviderBatchRow = {
  id: string;
  intentHash: string;
  companyCanonicalKey: string;
  companyName: string;
  companyDomain: string | null;
  companyLinkedinSlug: string | null;
  normalizedRoles: unknown;
  normalizedLocations: unknown;
  providerNextPage: number;
  providerPagesFetched: number;
  providerExhausted: boolean;
  provider?: string;
  brightNextPage?: number;
  brightPagesFetched?: number;
  brightExhausted?: boolean;
  apifyNextPage?: number;
  apifyPagesFetched?: number;
  apifyExhausted?: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type BatchPersonRow = {
  batchId: string;
  publicPersonId: string;
  providerSortIndex: number;
  provider?: string;
};

type RedisPayload = {
  schema: 1;
  cacheId: string | null;
  matchedCompanyKey: string | null;
  matchedCompanyDomain: string | null;
  sourceRoles: string[];
  sourceLocations: string[];
  people: ResolvedCachePerson[];
  definitiveEmpty: boolean;
};

type TrustedCompanyIdentity = {
  canonicalKey: string;
  domains: Set<string>;
  linkedinSlugs: Set<string>;
};

export interface DiscoverPublicKnowledgePort
  extends DiscoverCachePort,
    DiscoverCacheExpansionPort {
  readonly durablePublicKnowledge: true;
}

export function isDiscoverPublicKnowledgePort(
  value: DiscoverCachePort | DiscoverCacheExpansionPort
): value is DiscoverPublicKnowledgePort {
  return (value as { durablePublicKnowledge?: boolean }).durablePublicKnowledge === true;
}

export type DiscoverPublicKnowledgeServiceDeps = {
  prisma: PrismaClient;
  redis?: RedisResultClient;
  lock?: DiscoverCacheLock;
  now?: () => Date;
  resultTtlSeconds?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
};

/**
 * Durable Discover knowledge with Redis as an optional acceleration layer.
 *
 * Correctness always comes from DiscoverPublicPerson + provider provenance in
 * Postgres. Redis contains only sanitized exact-intent payloads and may be
 * flushed, malformed, or unavailable without changing search behavior.
 */
export class DiscoverPublicKnowledgeService implements DiscoverPublicKnowledgePort {
  readonly durablePublicKnowledge = true as const;

  private readonly prisma: PrismaClient;
  private readonly redis: RedisResultClient;
  private readonly lock: DiscoverCacheLock;
  private readonly now: () => Date;
  private readonly resultTtlSeconds: number;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(deps: DiscoverPublicKnowledgeServiceDeps) {
    this.prisma = deps.prisma;
    this.redis = deps.redis ?? (getRedis() as unknown as RedisResultClient);
    this.lock = deps.lock ?? createRedisCacheLock();
    this.now = deps.now ?? (() => new Date());
    this.resultTtlSeconds =
      deps.resultTtlSeconds ?? env.DISCOVER_REDIS_RESULT_TTL_SECONDS ?? DEFAULT_RESULT_TTL_SECONDS;
    this.waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async lookupReusableDataset(params: LookupReusableDatasetParams): Promise<DiscoverCacheResult> {
    const redisPayload = await this.readRedisPayload(params);
    if (redisPayload) {
      this.log("DISCOVER_REDIS_HIT", params, {
        databaseCandidateCount: 0,
        providerCalled: false
      });
      return resultFromRedis(redisPayload);
    }

    this.log("DISCOVER_REDIS_MISS", params, { providerCalled: false });
    const database = await this.lookupPostgres(params);
    if (database.dataset.people.length > 0 || database.definitiveEmpty) {
      await this.writeRedisPayload(params, payloadFromResult(database));
    }
    this.log(
      database.dataset.people.length > 0 ? "DISCOVER_DATABASE_HIT" : "DISCOVER_DATABASE_ZERO",
      params,
      {
        databaseCandidateCount: database.lookupDiagnostics?.candidatePersonCount ?? 0,
        providerCalled: false
      }
    );
    return database;
  }

  /** Email-format freshness belongs to ProspectCompany, not durable public people. */
  async updateEmailFormat(_params: UpdateCachedEmailFormatParams): Promise<void> {
    return undefined;
  }

  async getExpansionState(fingerprint: string): Promise<DiscoverCacheExpansionState | null> {
    const prisma = this.prisma as any;
    const batch = (await prisma.discoverProviderBatch.findUnique({
      where: { intentHash: fingerprint }
    })) as ProviderBatchRow | null;
    if (!batch) return null;
    const people = await this.peopleForBatches([batch]);
    return {
      cacheId: batch.id,
      providerNextPage: batch.providerNextPage,
      providerPagesFetched: batch.providerPagesFetched,
      providerExhausted: batch.providerExhausted,
      brightNextPage: batch.brightNextPage ?? 1,
      brightPagesFetched: batch.brightPagesFetched ?? 0,
      brightExhausted: batch.brightExhausted ?? false,
      apifyNextPage: batch.apifyNextPage ?? batch.providerNextPage,
      apifyPagesFetched: batch.apifyPagesFetched ?? batch.providerPagesFetched,
      apifyExhausted: batch.apifyExhausted ?? batch.providerExhausted,
      emailFormat: emptyEmailFormat(),
      people
    };
  }

  /**
   * The only provider-ingestion path: sanitize, dedupe, durable upsert, attach
   * exact provider provenance, then advance the cheap Redis company version.
   */
  async appendProviderPeople(
    params: AppendProviderPeopleParams
  ): Promise<DiscoverCacheExpansionState> {
    const prisma = this.prisma as any;
    const now = this.now();
    const companyDomain = normalizeDomain(params.company.domain);
    const companyLinkedinSlug = normalizeLinkedinCompanySlug(params.company.linkedinUrl);
    const canonicalKey = params.fingerprintInput.companyKey;
    const provider = params.provider ?? "APIFY";
    const dedupe = new PersonIdentitySet();
    const people = params.people.filter((person) => dedupe.addIfNew(person)).map(sanitizePerson);

    const existingBatch = (await prisma.discoverProviderBatch.findUnique({
      where: { intentHash: params.fingerprint }
    })) as ProviderBatchRow | null;
    const brightExhausted = provider === "BRIGHTDATA_GOOGLE"
      ? params.exhausted
      : existingBatch?.brightExhausted ?? false;
    const apifyExhausted = provider === "APIFY"
      ? params.exhausted
      : existingBatch?.apifyExhausted ?? existingBatch?.providerExhausted ?? false;
    const hasBrightAttempt = provider === "BRIGHTDATA_GOOGLE" || (existingBatch?.brightPagesFetched ?? 0) > 0;
    const allAttemptedProvidersExhausted = hasBrightAttempt
      ? brightExhausted && apifyExhausted
      : apifyExhausted;
    const batch = (await prisma.discoverProviderBatch.upsert({
      where: { intentHash: params.fingerprint },
      create: {
        intentHash: params.fingerprint,
        companyCanonicalKey: canonicalKey,
        companyName: params.company.name,
        companyDomain,
        companyLinkedinSlug,
        normalizedRoles: params.fingerprintInput.roles,
        normalizedLocations: params.fingerprintInput.locations,
        provider,
        providerRunId: params.providerRunId ?? null,
        providerDatasetId: params.providerDatasetId ?? null,
        providerNextPage: params.nextPage,
        providerPagesFetched: params.pagesFetched,
        providerExhausted: allAttemptedProvidersExhausted,
        brightNextPage: provider === "BRIGHTDATA_GOOGLE" ? params.nextPage : 1,
        brightPagesFetched: provider === "BRIGHTDATA_GOOGLE" ? params.pagesFetched : 0,
        brightExhausted: provider === "BRIGHTDATA_GOOGLE" ? params.exhausted : false,
        apifyNextPage: provider === "APIFY" ? params.nextPage : 1,
        apifyPagesFetched: provider === "APIFY" ? params.pagesFetched : 0,
        apifyExhausted: provider === "APIFY" ? params.exhausted : false,
        lastProviderFetchAt: now
      },
      update: {
        companyCanonicalKey: canonicalKey,
        companyName: params.company.name,
        companyDomain,
        companyLinkedinSlug,
        normalizedRoles: params.fingerprintInput.roles,
        normalizedLocations: params.fingerprintInput.locations,
        provider: existingBatch?.provider && existingBatch.provider !== provider ? "MIXED" : provider,
        providerRunId: params.providerRunId ?? undefined,
        providerDatasetId: params.providerDatasetId ?? undefined,
        providerNextPage: params.nextPage,
        providerPagesFetched: (existingBatch?.providerPagesFetched ?? 0) + params.pagesFetched,
        providerExhausted: allAttemptedProvidersExhausted,
        ...(provider === "BRIGHTDATA_GOOGLE"
          ? {
              brightNextPage: params.nextPage,
              brightPagesFetched: (existingBatch?.brightPagesFetched ?? 0) + params.pagesFetched,
              brightExhausted: params.exhausted
            }
          : {
              apifyNextPage: params.nextPage,
              apifyPagesFetched: (existingBatch?.apifyPagesFetched ?? existingBatch?.providerPagesFetched ?? 0) + params.pagesFetched,
              apifyExhausted: params.exhausted
            }),
        lastProviderFetchAt: now
      }
    })) as ProviderBatchRow;

    const existingCompanyPeople = (await prisma.discoverPublicPerson.findMany({
      where: { companyCanonicalKey: canonicalKey }
    })) as PublicPersonRow[];
    const bySourceId = new Map(existingCompanyPeople.map((person) => [person.sourceProfileId, person]));
    const byLinkedin = new Map(
      existingCompanyPeople
        .filter((person) => person.normalizedLinkedinUrl)
        .map((person) => [person.normalizedLinkedinUrl as string, person])
    );
    const persisted: PublicPersonRow[] = [];
    let createdCount = 0;
    for (const person of people) {
      const normalizedLinkedinUrl = normalizeLinkedinProfileUrl(person.linkedinUrl);
      const existing = bySourceId.get(person.sourceProfileId) ?? byLinkedin.get(normalizedLinkedinUrl);
      const common = {
        companyCanonicalKey: canonicalKey,
        companyDomain,
        companyLinkedinSlug,
        sourceProfileId: person.sourceProfileId,
        linkedinUrl: person.linkedinUrl,
        normalizedLinkedinUrl,
        firstName: person.firstName,
        lastName: person.lastName,
        fullName: person.fullName,
        sourceName: person.sourceName ?? null,
        nameNormalization: person.nameNormalization ?? null,
        currentTitle: person.currentTitle,
        normalizedTitle: person.normalizedTitle,
        positionCategory: person.positionCategory,
        location: person.location,
        country: person.country,
        state: person.state,
        city: person.city,
        lastSeenAt: now
      };
      const row = existing
        ? await prisma.discoverPublicPerson.update({
            where: { id: existing.id },
            data: { ...common, sourceProfileId: existing.sourceProfileId }
          })
        : await prisma.discoverPublicPerson.create({
            data: { ...common, firstSeenAt: now }
          });
      if (!existing) createdCount += 1;
      persisted.push(row as PublicPersonRow);
      bySourceId.set(person.sourceProfileId, row as PublicPersonRow);
      if (normalizedLinkedinUrl) byLinkedin.set(normalizedLinkedinUrl, row as PublicPersonRow);
    }

    const existingLinks = (await prisma.discoverProviderBatchPerson.findMany({
      where: { batchId: batch.id }
    })) as BatchPersonRow[];
    const linked = new Set(existingLinks.map((link) => link.publicPersonId));
    let sortIndex = existingLinks.reduce(
      (maximum, link) => Math.max(maximum, link.providerSortIndex + 1),
      0
    );
    for (const person of persisted) {
      if (linked.has(person.id)) continue;
      await prisma.discoverProviderBatchPerson.create({
        data: { batchId: batch.id, publicPersonId: person.id, providerSortIndex: sortIndex, provider }
      });
      linked.add(person.id);
      sortIndex += 1;
    }

    await this.bumpCompanyVersion(canonicalKey);
    const state = (await this.getExpansionState(params.fingerprint))!;
    await this.writeRedisPayload(
      {
        fingerprint: params.fingerprint,
        fingerprintInput: params.fingerprintInput
      },
      {
        schema: 1,
        cacheId: state.cacheId,
        matchedCompanyKey: canonicalKey,
        matchedCompanyDomain: companyDomain,
        sourceRoles: params.fingerprintInput.roles,
        sourceLocations: params.fingerprintInput.locations,
        people: state.people,
        definitiveEmpty: state.people.length === 0 && params.exhausted
      }
    );
    this.log("DISCOVER_PUBLIC_PERSON_UPSERT", {
      fingerprint: params.fingerprint,
      fingerprintInput: params.fingerprintInput,
      company: params.company
    }, {
      providerCalled: true,
      providerNewUniqueCount: createdCount
    });
    return state;
  }

  async markProviderExhausted(fingerprint: string, provider: "BRIGHTDATA_GOOGLE" | "APIFY" = "APIFY"): Promise<void> {
    const prisma = this.prisma as any;
    await prisma.discoverProviderBatch.update({
      where: { intentHash: fingerprint },
      data: {
        providerExhausted: true,
        ...(provider === "BRIGHTDATA_GOOGLE" ? { brightExhausted: true } : { apifyExhausted: true }),
        lastProviderFetchAt: this.now()
      }
    });
  }

  async runWithProviderLock<T>(fingerprint: string, fn: () => Promise<T>): Promise<T> {
    const key = `${LOCK_KEY_PREFIX}:${fingerprint}`;
    const deadline = Date.now() + this.waitTimeoutMs;
    let token: string | null;
    try {
      token = await this.lock.acquire(key);
    } catch {
      return fn();
    }
    while (!token && Date.now() < deadline) {
      await delay(this.pollIntervalMs);
      try {
        token = await this.lock.acquire(key);
      } catch {
        return fn();
      }
    }
    if (!token) return fn();
    try {
      return await fn();
    } finally {
      try {
        await this.lock.release(key, token);
      } catch {
        // The lock has a TTL and can never be a correctness dependency.
      }
    }
  }

  private async lookupPostgres(params: LookupReusableDatasetParams): Promise<DiscoverCacheResult> {
    const prisma = this.prisma as any;
    const requested = trustedIdentity(params.fingerprintInput.companyKey, params.company);
    const predicates = identityPredicates(requested);
    const rows = (await prisma.discoverProviderBatch.findMany({
      where: predicates.length > 0 ? { OR: predicates } : { companyCanonicalKey: requested.canonicalKey }
    })) as ProviderBatchRow[];
    const batches = rows
      .filter((batch) => sameTrustedCompany(requested, batchIdentity(batch)))
      .sort((left, right) => {
        const leftExact = left.intentHash === params.fingerprint ? 1 : 0;
        const rightExact = right.intentHash === params.fingerprint ? 1 : 0;
        return rightExact - leftExact || time(right.createdAt) - time(left.createdAt);
      });
    if (batches.length === 0) return emptyResult(false);

    const prismaLinks = (await prisma.discoverProviderBatchPerson.findMany({
      where: { batchId: { in: batches.map((batch) => batch.id) } }
    })) as BatchPersonRow[];
    const peopleIds = [...new Set(prismaLinks.map((link) => link.publicPersonId))];
    const publicRows = peopleIds.length
      ? ((await prisma.discoverPublicPerson.findMany({ where: { id: { in: peopleIds } } })) as PublicPersonRow[])
      : [];
    const byId = new Map(publicRows.map((person) => [person.id, person]));
    const linksByBatch = new Map<string, BatchPersonRow[]>();
    for (const link of prismaLinks) {
      const links = linksByBatch.get(link.batchId) ?? [];
      links.push(link);
      linksByBatch.set(link.batchId, links);
    }

    const identities = new PersonIdentitySet();
    const accepted: ResolvedCachePerson[] = [];
    let matchedBatch: ProviderBatchRow | null = null;
    let exactIntent = false;
    for (const batch of batches) {
      const sourceRoles = strings(batch.normalizedRoles);
      const sourceLocations = strings(batch.normalizedLocations);
      const exact = sameNormalizedIntent(
        sourceRoles,
        sourceLocations,
        params.fingerprintInput.roles,
        params.fingerprintInput.locations
      );
      const sourcePeople = (linksByBatch.get(batch.id) ?? [])
        .sort((left, right) => left.providerSortIndex - right.providerSortIndex)
        .map((link) => byId.get(link.publicPersonId))
        .filter((person): person is PublicPersonRow => Boolean(person))
        .map(publicRowToResolved);
      const filtered = exact
        ? sourcePeople
        : params.filterCompanyPoolPeople
          ? await params.filterCompanyPoolPeople(sourcePeople, sourceForBatch(batch))
          : [];
      for (const person of filtered) {
        if (!identities.addIfNew(person)) continue;
        accepted.push(person);
        if (!matchedBatch) {
          matchedBatch = batch;
          exactIntent = exact;
        }
      }
    }

    const diagnostics: DiscoverCacheLookupDiagnostics = {
      candidateEntryCount: batches.length,
      candidatePersonCount: prismaLinks.length,
      matchingPersonCount: accepted.length
    };
    if (!matchedBatch) {
      const exactEmpty = batches.find(
        (batch) =>
          batch.providerExhausted &&
          sameNormalizedIntent(
            strings(batch.normalizedRoles),
            strings(batch.normalizedLocations),
            params.fingerprintInput.roles,
            params.fingerprintInput.locations
          )
      );
      return { ...emptyResult(Boolean(exactEmpty)), lookupDiagnostics: diagnostics };
    }
    return {
      dataset: { emailFormat: emptyEmailFormat(), people: accepted },
      source: "CACHE",
      cacheId: matchedBatch.id,
      fetchedAt: new Date(matchedBatch.createdAt),
      refreshedStale: false,
      cacheHitType: matchedBatch.intentHash === params.fingerprint ? "EXACT" : "COMPANY_POOL",
      storageHitType:
        matchedBatch.intentHash === params.fingerprint ? "DATABASE_EXACT" : "DATABASE_POOL",
      lookupDiagnostics: diagnostics,
      matchedCacheCompanyKey: matchedBatch.companyCanonicalKey,
      matchedCompanyDomain: matchedBatch.companyDomain,
      sourceNormalizedRoles: strings(matchedBatch.normalizedRoles),
      sourceNormalizedLocations: strings(matchedBatch.normalizedLocations),
      legacyIdentityMatch:
        matchedBatch.companyCanonicalKey !== params.fingerprintInput.companyKey &&
        normalizeDomain(matchedBatch.companyDomain) === normalizeDomain(params.company.domain),
      exactIntentReuse: exactIntent,
      definitiveEmpty: false
    };
  }

  private async peopleForBatches(batches: ProviderBatchRow[]): Promise<ResolvedCachePerson[]> {
    if (batches.length === 0) return [];
    const prisma = this.prisma as any;
    const links = (await prisma.discoverProviderBatchPerson.findMany({
      where: { batchId: { in: batches.map((batch) => batch.id) } }
    })) as BatchPersonRow[];
    const ids = [...new Set(links.map((link) => link.publicPersonId))];
    const rows = ids.length
      ? ((await prisma.discoverPublicPerson.findMany({ where: { id: { in: ids } } })) as PublicPersonRow[])
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return links
      .sort((left, right) => left.providerSortIndex - right.providerSortIndex)
      .map((link) => byId.get(link.publicPersonId))
      .filter((person): person is PublicPersonRow => Boolean(person))
      .map(publicRowToResolved);
  }

  private async readRedisPayload(
    params: Pick<LookupReusableDatasetParams, "fingerprint" | "fingerprintInput">
  ): Promise<RedisPayload | null> {
    try {
      const key = await this.redisResultKey(params);
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RedisPayload>;
      if (parsed.schema !== 1 || !Array.isArray(parsed.people)) return null;
      if (!parsed.people.every(isSafeCachedPerson)) return null;
      return {
        schema: 1,
        cacheId: typeof parsed.cacheId === "string" ? parsed.cacheId : null,
        matchedCompanyKey:
          typeof parsed.matchedCompanyKey === "string" ? parsed.matchedCompanyKey : null,
        matchedCompanyDomain:
          typeof parsed.matchedCompanyDomain === "string" ? parsed.matchedCompanyDomain : null,
        sourceRoles: strings(parsed.sourceRoles),
        sourceLocations: strings(parsed.sourceLocations),
        people: parsed.people.map(sanitizePerson),
        definitiveEmpty: parsed.definitiveEmpty === true
      };
    } catch {
      return null;
    }
  }

  private async writeRedisPayload(
    params: Pick<LookupReusableDatasetParams, "fingerprint" | "fingerprintInput">,
    payload: RedisPayload
  ): Promise<void> {
    try {
      const key = await this.redisResultKey(params);
      await this.redis.set(key, JSON.stringify(payload), "EX", this.resultTtlSeconds);
    } catch {
      // Redis is acceleration only. Durable Postgres writes/reads still succeed.
    }
  }

  private async redisResultKey(
    params: Pick<LookupReusableDatasetParams, "fingerprint" | "fingerprintInput">
  ): Promise<string> {
    const canonicalKey = params.fingerprintInput.companyKey;
    let version = "0";
    try {
      version = (await this.redis.get(`${COMPANY_VERSION_KEY_PREFIX}:${canonicalKey}`)) ?? "0";
    } catch {
      // A stable zero version still permits the caller to continue to Postgres.
    }
    const companyHash = createHash("sha256").update(canonicalKey).digest("hex").slice(0, 16);
    return `${RESULT_KEY_PREFIX}:${params.fingerprintInput.cacheVersion}:${companyHash}:${version}:${params.fingerprint}`;
  }

  private async bumpCompanyVersion(canonicalKey: string): Promise<void> {
    try {
      await this.redis.incr(`${COMPANY_VERSION_KEY_PREFIX}:${canonicalKey}`);
    } catch {
      // The durable write is already complete; Redis failure cannot roll it back.
    }
  }

  private log(
    event: string,
    params: Pick<LookupReusableDatasetParams, "fingerprintInput"> & {
      company: DiscoverCacheCompany;
      fingerprint?: string;
    },
    fields: Record<string, unknown>
  ): void {
    if (process.env.NODE_ENV === "test") return;
    console.info(
      JSON.stringify({
        event,
        canonicalCompanyKey: params.fingerprintInput.companyKey,
        normalizedRoles: params.fingerprintInput.roles,
        normalizedLocations: params.fingerprintInput.locations,
        ...fields
      })
    );
  }
}

function resultFromRedis(payload: RedisPayload): DiscoverCacheResult {
  return {
    dataset: { emailFormat: emptyEmailFormat(), people: payload.people },
    source: "CACHE",
    cacheId: payload.cacheId,
    fetchedAt: null,
    refreshedStale: false,
    cacheHitType: "EXACT",
    storageHitType: "REDIS",
    lookupDiagnostics: { candidateEntryCount: 0, candidatePersonCount: 0, matchingPersonCount: payload.people.length },
    matchedCacheCompanyKey: payload.matchedCompanyKey,
    matchedCompanyDomain: payload.matchedCompanyDomain,
    sourceNormalizedRoles: payload.sourceRoles,
    sourceNormalizedLocations: payload.sourceLocations,
    exactIntentReuse: true,
    definitiveEmpty: payload.definitiveEmpty
  };
}

function payloadFromResult(result: DiscoverCacheResult): RedisPayload {
  return {
    schema: 1,
    cacheId: result.cacheId,
    matchedCompanyKey: result.matchedCacheCompanyKey ?? null,
    matchedCompanyDomain: result.matchedCompanyDomain ?? null,
    sourceRoles: result.sourceNormalizedRoles ?? [],
    sourceLocations: result.sourceNormalizedLocations ?? [],
    people: result.dataset.people.map(sanitizePerson),
    definitiveEmpty: result.definitiveEmpty === true
  };
}

function emptyResult(definitiveEmpty: boolean): DiscoverCacheResult {
  return {
    dataset: { emailFormat: emptyEmailFormat(), people: [] },
    source: "CACHE",
    cacheId: null,
    fetchedAt: null,
    refreshedStale: false,
    cacheHitType: null,
    storageHitType: null,
    lookupDiagnostics: { candidateEntryCount: 0, candidatePersonCount: 0, matchingPersonCount: 0 },
    definitiveEmpty
  };
}

function publicRowToResolved(row: PublicPersonRow): ResolvedCachePerson {
  return sanitizePerson({
    sourceProfileId: row.sourceProfileId,
    sourceName: row.sourceName ?? null,
    nameNormalization: row.nameNormalization ?? null,
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
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null
  });
}

function sanitizePerson(person: ResolvedCachePerson): ResolvedCachePerson {
  return {
    sourceProfileId: person.sourceProfileId,
    sourceName: person.sourceName ?? null,
    nameNormalization: person.nameNormalization ?? null,
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName,
    currentTitle: person.currentTitle ?? null,
    normalizedTitle: person.normalizedTitle ?? null,
    positionCategory: person.positionCategory || "OTHER",
    location: person.location ?? null,
    country: person.country ?? null,
    state: person.state ?? null,
    city: person.city ?? null,
    linkedinUrl: person.linkedinUrl,
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null
  };
}

function isSafeCachedPerson(value: unknown): value is ResolvedCachePerson {
  if (!value || typeof value !== "object") return false;
  const person = value as Partial<ResolvedCachePerson>;
  return (
    typeof person.sourceProfileId === "string" &&
    typeof person.firstName === "string" &&
    typeof person.lastName === "string" &&
    typeof person.fullName === "string" &&
    typeof person.linkedinUrl === "string"
  );
}

function trustedIdentity(companyKey: string, company: DiscoverCacheCompany): TrustedCompanyIdentity {
  const domains = new Set<string>();
  const linkedinSlugs = new Set<string>();
  const domain = normalizeDomain(company.domain);
  if (domain) domains.add(domain);
  const slug = normalizeLinkedinCompanySlug(company.linkedinUrl);
  if (slug) linkedinSlugs.add(slug);
  if (companyKey.startsWith("domain:")) {
    const fromKey = normalizeDomain(companyKey.slice("domain:".length));
    if (fromKey) domains.add(fromKey);
  }
  if (companyKey.startsWith("linkedin:")) {
    const fromKey = companyKey.slice("linkedin:".length).trim().toLowerCase();
    if (fromKey) linkedinSlugs.add(fromKey);
  }
  return { canonicalKey: companyKey, domains, linkedinSlugs };
}

function batchIdentity(batch: ProviderBatchRow): TrustedCompanyIdentity {
  return trustedIdentity(batch.companyCanonicalKey, {
    name: batch.companyName,
    domain: batch.companyDomain,
    linkedinUrl: batch.companyLinkedinSlug
      ? `https://www.linkedin.com/company/${batch.companyLinkedinSlug}`
      : null
  });
}

function sameTrustedCompany(left: TrustedCompanyIdentity, right: TrustedCompanyIdentity): boolean {
  if (left.domains.size > 1 || right.domains.size > 1) return false;
  if (left.domains.size > 0 && right.domains.size > 0) {
    return intersects(left.domains, right.domains);
  }
  if (intersects(left.linkedinSlugs, right.linkedinSlugs)) return true;
  return left.canonicalKey === right.canonicalKey;
}

function identityPredicates(identity: TrustedCompanyIdentity): Array<Record<string, unknown>> {
  const predicates: Array<Record<string, unknown>> = [{ companyCanonicalKey: identity.canonicalKey }];
  for (const domain of identity.domains) predicates.push({ companyDomain: domain });
  for (const slug of identity.linkedinSlugs) predicates.push({ companyLinkedinSlug: slug });
  return predicates;
}

function sourceForBatch(batch: ProviderBatchRow): DiscoverCompanyPoolSource {
  return {
    cacheId: batch.id,
    companyKey: batch.companyCanonicalKey,
    companyDomain: normalizeDomain(batch.companyDomain),
    normalizedRoles: strings(batch.normalizedRoles),
    normalizedLocations: strings(batch.normalizedLocations)
  };
}

function emptyEmailFormat(): ResolvedEmailFormat {
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeLinkedinProfileUrl(value: string): string {
  return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
