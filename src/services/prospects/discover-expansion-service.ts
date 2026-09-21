import { protectNameRepairSuppressions } from "@/services/prospects/discover-person-name-repair";
import { normalizeDiscoverPersonNames } from "@/services/prospects/discover-person-name-normalization";
import { nameStateFields } from "@/services/prospects/discover-name-contract";
import type { PrismaClient, ProspectCompany, ProspectSearch } from "@prisma/client";

import { recordAuditEvent, type RecordAuditEventArgs } from "@/lib/audit";
import {
  formatDiscoverExpansionLimitMessage,
  getDiscoverQuotaStatus,
  resolveResultsPerSearch,
  reserveDiscoverSearchSlot,
  type DiscoverQuotaReserver,
  type DiscoverQuotaStatus
} from "@/lib/discover-quota";
import { env } from "@/lib/env";
import { coercePositionCategory, displayNameForCategory, type PositionCategory } from "@/lib/prospect-enums";
import { ApifyProfileSearchService } from "@/services/prospects/apify-profile-search";
import { normalizeLinkedinCompanySlug } from "@/services/prospects/canonical-company";
import {
  createRedisCacheLock,
  resolveSharedCacheVersion,
  type DiscoverCacheCompany,
  type DiscoverCacheExpansionPort,
  type DiscoverCachePort,
  type DiscoverCacheLock,
  type ResolvedCachePerson,
  type ResolvedEmailFormat
} from "@/services/prospects/discover-cache-service";
import {
  DiscoverPublicKnowledgeService,
  isDiscoverPublicKnowledgePort
} from "@/services/prospects/discover-public-knowledge-service";
import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import {
  createDiscoverRoleIntelligenceService,
  type DiscoverRoleIntelligencePort
} from "@/services/prospects/discover-role-intelligence-service";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { DiscoverPeopleProviderOrchestrator } from "@/services/prospects/discover-people-provider-orchestrator";
import { createAiBudget } from "@/services/prospects/prospect-ai";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";
import { ProspectError } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

// One Apify page is 25 profiles. A continuation fetch pulls a full page so the
// shared cache accumulates every normalized public result the provider returns
// (never restricted to the 10 a single expansion materializes).
const PROVIDER_PAGE_SIZE = 25;

export type ExpansionStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type DiscoverExpansionResult = {
  id: string;
  searchId: string;
  status: ExpansionStatus;
  requestedCount: number;
  addedCount: number;
  totalPeopleCount: number;
  quotaRemaining: number;
  exhausted: boolean;
  message: string | null;
};

export type AddMorePeopleInput = {
  userId: string;
  /** Authenticated account email (session-resolved) for the quota exemption. */
  actorEmail: string | null;
  searchId: string;
  /** Client-generated key making double clicks / retries idempotent. */
  idempotencyKey: string;
};

export type ExpansionAuditFn = (args: RecordAuditEventArgs) => Promise<void> | void;

export type DiscoverExpansionServiceDeps = {
  prisma: PrismaClient;
  apify: ApifyProfileSearchService;
  roleClassifier: RoleClassificationService;
  roleIntelligence?: DiscoverRoleIntelligencePort;
  /** Defaults to the durable shared people store (provides continuation state). */
  cache?: DiscoverCacheExpansionPort & Partial<DiscoverCachePort>;
  /** Defaults to the Redis-backed atomic daily quota (idempotent per expansion). */
  discoverQuota?: DiscoverQuotaReserver;
  /** Read-only quota status (for paths that don't reserve). Defaults to Redis. */
  quotaStatus?: (userId: string, email: string | null) => Promise<DiscoverQuotaStatus>;
  /** Per-search lock so only one expansion runs for a search at a time. */
  expansionLock?: DiscoverCacheLock;
  /** Injectable clock + audit sink for tests. */
  now?: () => Date;
  audit?: ExpansionAuditFn;
  batchSize?: number;
  maxProviderPages?: number;
  providerOrchestrator?: DiscoverPeopleProviderOrchestrator;
  /** Fallback resolver for incomplete person names; see the search service. */
};

const EXPANSION_LOCK_PREFIX = "discover:expansion";

/** Effective people-per-expansion batch (env override, defaulting to 10). */
export function resolveExpansionBatchSize(): number {
  const configured = env.DISCOVER_EXPANSION_BATCH_SIZE;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : 10;
}

/** Effective provider-page safety cap per expansion (env override, defaulting to 5). */
export function resolveExpansionMaxProviderPages(): number {
  const configured = env.DISCOVER_EXPANSION_MAX_PROVIDER_PAGES;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : 5;
}

/**
 * "Add 10 more people" for an existing READY Discover search. Extends the same
 * search (no new Search History row) with up to a batch of NEW unique people,
 * reusing unused people from the shared cache first and only then continuing the
 * Apify search from its saved provider page. Each successful expansion consumes
 * exactly one daily Discover slot (idempotent per expansion id, so retries never
 * double-charge); concurrent requests for one search are serialized by a lock and
 * can never add duplicate batches.
 *
 * The resolver stays thin — it just authenticates and delegates here.
 */
export class DiscoverExpansionService {
  private readonly prisma: PrismaClient;
  private readonly roleIntelligence: DiscoverRoleIntelligencePort;
  private readonly cache: DiscoverCacheExpansionPort & Partial<DiscoverCachePort>;
  private readonly discoverQuota: DiscoverQuotaReserver;
  private readonly quotaStatus: (userId: string, email: string | null) => Promise<DiscoverQuotaStatus>;
  private readonly expansionLock: DiscoverCacheLock;
  private readonly now: () => Date;
  private readonly audit: ExpansionAuditFn;
  private readonly batchSize: number;
  private readonly maxProviderPages: number;
  private readonly providerOrchestrator: DiscoverPeopleProviderOrchestrator;

  constructor(deps: DiscoverExpansionServiceDeps) {
    this.prisma = deps.prisma;
    this.roleIntelligence =
      deps.roleIntelligence ?? createDiscoverRoleIntelligenceService(deps.prisma, deps.roleClassifier);
    this.cache = deps.cache ?? new DiscoverPublicKnowledgeService({ prisma: deps.prisma });
    this.discoverQuota = deps.discoverQuota ?? reserveDiscoverSearchSlot;
    this.quotaStatus = deps.quotaStatus ?? getDiscoverQuotaStatus;
    this.expansionLock = deps.expansionLock ?? createRedisCacheLock();
    this.now = deps.now ?? (() => new Date());
    this.audit = deps.audit ?? recordAuditEvent;
    this.batchSize = deps.batchSize ?? resolveExpansionBatchSize();
    this.maxProviderPages = deps.maxProviderPages ?? resolveExpansionMaxProviderPages();
    this.providerOrchestrator = deps.providerOrchestrator ?? new DiscoverPeopleProviderOrchestrator({
      apify: deps.apify,
      roleClassifier: deps.roleClassifier,
      roleIntelligence: this.roleIntelligence
    });
  }

  async addMorePeople(input: AddMorePeopleInput): Promise<DiscoverExpansionResult> {
    const { userId, actorEmail, searchId, idempotencyKey } = input;

    // 1-5. Authenticate (done in the resolver), load + own the search, confirm it
    // is READY and has the canonical company / roles / locations to continue.
    const search = await this.requireOwnedSearch(userId, searchId);
    if (search.status !== "READY" && search.status !== "NO_RESULTS") {
      throw new ProspectError("INVALID_STATE", "Only a completed search can add more people.");
    }
    const roles = asStringArray(search.requestedTitles);
    if (!search.companyId || roles.length === 0) {
      throw new ProspectError("INVALID_STATE", "This search cannot add more people.");
    }
    const company = await this.prisma.prospectCompany.findFirst({ where: { id: search.companyId, userId } });
    if (!company) {
      throw new ProspectError("NOT_FOUND", "Company not found.");
    }
    const locations = asStringArray(search.requestedLocations);

    // Serialize all expansions for this search: only one active at a time.
    const lockKey = `${EXPANSION_LOCK_PREFIX}:${searchId}`;
    let lockToken: string | null;
    let lockUnavailable = false;
    try {
      lockToken = await this.expansionLock.acquire(lockKey);
    } catch {
      // Redis locking is request coalescing, not a correctness dependency. DB
      // uniqueness/idempotency still converges duplicate allocations.
      lockToken = "redis-unavailable";
      lockUnavailable = true;
    }
    if (!lockToken) {
      const existing = await this.findExpansion(searchId, idempotencyKey);
      if (existing && existing.status === "READY") {
        return this.toResult(existing, await this.quotaRemaining(userId, actorEmail), existing.exhausted, null);
      }
      throw new ProspectError("DISCOVER_EXPANSION_ALREADY_RUNNING", "This search is already adding more people. Try again in a moment.");
    }

    try {
      // 6. Create an idempotent expansion request. A completed one for the same
      // key returns its stored result without redoing work or charging again.
      let expansion = await this.findExpansion(searchId, idempotencyKey);
      if (expansion && expansion.status === "READY") {
        return this.toResult(expansion, await this.quotaRemaining(userId, actorEmail), expansion.exhausted, null);
      }
      expansion = expansion
        ? await this.prisma.discoverSearchExpansion.update({
            where: { id: expansion.id },
            data: { status: "PROCESSING", errorCode: null }
          })
        : await this.prisma.discoverSearchExpansion.create({
            data: { searchId, userId, idempotencyKey, requestedCount: this.batchSize, status: "PROCESSING" }
          });

      await this.safeAudit("DISCOVER_EXPANSION_STARTED", userId, actorEmail, searchId, {
        expansionId: expansion.id,
        requestedCount: this.batchSize
      });

      const { input: fingerprintInput, fingerprint } = this.buildFingerprint(company, roles, locations);
      const cacheCompany: DiscoverCacheCompany = {
        name: company.officialName ?? company.name,
        domain: company.officialWebsiteDomain ?? company.officialDomain,
        linkedinUrl: company.linkedinUrl
      };

      // 8. Determine which people already belong to THIS search (its allocation
      // grants, by stable identity) so they are never repeated. Another role
      // search for the same company keeps its own separate allocation.
      const { identities, allocatedCount } = await this.loadExistingIdentities(userId, search.id, company.id);

      // 9. Consume every matching unused database candidate before provider
      // continuation. Cache age is irrelevant, and requester-owned people are
      // eligible even when this exact fingerprint has no continuation row yet.
      const cacheState = await this.cache.getExpansionState(fingerprint);
      const durableResult =
        isDiscoverPublicKnowledgePort(this.cache) && this.cache.lookupReusableDataset
          ? await this.cache.lookupReusableDataset({
              fingerprint,
              fingerprintInput,
              company: cacheCompany,
              filterCompanyPoolPeople: (people, source) =>
                this.roleIntelligence.filterAndRankPeople({
                  people,
                  requestedTitles: roles,
                  requestedLocations: locations,
                  sourceRequestedLocations: source.normalizedLocations,
                  context: "CACHE",
                  options: { budget: createAiBudget(), searchId: search.id }
                })
            })
          : null;
      const cacheCandidates = durableResult
        ? durableResult.dataset.people
        : cacheState
          ? await this.roleIntelligence.filterAndRankPeople({
              people: cacheState.people,
              requestedTitles: roles,
              requestedLocations: locations,
              context: "CACHE",
              options: { budget: createAiBudget(), searchId: search.id }
            })
          : [];
      const localCandidates = isDiscoverPublicKnowledgePort(this.cache)
        ? []
        : await this.loadReusableLocalCandidates({ userId, search, company, roles, locations });
      const databaseIdentities = new PersonIdentitySet();
      const unusedCached = [...cacheCandidates, ...localCandidates].filter(
        (person) => !identities.has(person) && databaseIdentities.addIfNew(person)
      );
      const providerExhausted =
        (!this.providerOrchestrator.brightConfigured || (cacheState?.brightExhausted ?? false)) &&
        (cacheState?.apifyExhausted ?? cacheState?.providerExhausted ?? false);
      await this.safeAudit(
        unusedCached.length > 0
          ? "DISCOVER_ADD_MORE_DATABASE_HIT"
          : "DISCOVER_ADD_MORE_DATABASE_EXHAUSTED",
        userId,
        actorEmail,
        searchId,
        {
          canonicalCompanyKey: fingerprintInput.companyKey,
          normalizedRoles: fingerprintInput.roles,
          normalizedLocations: fingerprintInput.locations,
          unusedCandidateCount: unusedCached.length,
          providerCalled: false
        }
      );

      // Early no-op: provider already exhausted and nothing unused remains. Do
      // not consume a daily slot for a request that cannot add anyone.
      if (providerExhausted && unusedCached.length === 0) {
        const remaining = await this.quotaRemaining(userId, actorEmail);
        const completed = await this.completeExpansion(expansion.id, {
          addedCount: 0,
          cacheCount: 0,
          providerCount: 0,
          totalPeopleCount: allocatedCount > 0 ? allocatedCount : search.totalProcessed,
          exhausted: true
        });
        return this.toResult(completed, remaining, true, NO_MORE_PEOPLE_MESSAGE);
      }

      // 7. Reserve one daily Discover slot — idempotent on the EXPANSION id, so a
      // retry of this expansion (after a failure) never consumes a second slot.
      const reservation = await this.discoverQuota({ userId, email: actorEmail, searchId: expansion.id });
      if (!reservation.allowed) {
        await this.prisma.discoverSearchExpansion.update({
          where: { id: expansion.id },
          data: { status: "FAILED", errorCode: "DISCOVER_DAILY_LIMIT_REACHED" }
        });
        throw new ProspectError("DISCOVER_DAILY_LIMIT_REACHED", formatDiscoverExpansionLimitMessage(reservation.status));
      }
      if (!expansion.quotaReserved) {
        await this.prisma.discoverSearchExpansion.update({ where: { id: expansion.id }, data: { quotaReserved: true } });
      }

      // 10-14. Materialize cached people first, then continue the provider.
      let toAdd: ResolvedCachePerson[];
      let cacheCount: number;
      let providerCount: number;
      let exhausted: boolean;
      try {
        const outcome = await this.collectNewPeople({
          search,
          company,
          roles,
          locations,
          fingerprint,
          fingerprintInput,
          cacheCompany,
          cacheEmailFormat: cacheState?.emailFormat ?? this.companyEmailFormat(company),
          identities,
          unusedCached,
          providerExhausted,
          userId,
          actorEmail
        });
        toAdd = outcome.people;
        cacheCount = outcome.cacheCount;
        providerCount = outcome.providerCount;
        exhausted = outcome.exhausted;
      } catch (error) {
        // Provider continuation failed: preserve existing people, mark only the
        // expansion failed, and allow a retry without another quota charge.
        await this.prisma.discoverSearchExpansion.update({
          where: { id: expansion.id },
          data: { status: "FAILED", errorCode: "DISCOVER_EXPANSION_FAILED" }
        });
        await this.safeAudit("DISCOVER_EXPANSION_FAILED", userId, actorEmail, searchId, {
          expansionId: expansion.id,
          errorCode: safeCode(error)
        });
        throw new ProspectError("DISCOVER_EXPANSION_FAILED", "We couldn't add more people right now. Please try again.");
      }

      const materialized = await this.materializePeople(userId, search, company, toAdd, {
        cacheCount,
        allocationOrderBase: allocatedCount
      });
      const addedCount = materialized.allocationAddedCount;
      const durableAllocationCount = await this.prisma.prospectSearchPerson.count({ where: { searchId: search.id } });
      // Allocation-backed searches use the durable grant count as their source
      // of truth. The legacy fallback is retained only for pre-allocation rows
      // whose old people were never backfilled into ProspectSearchPerson.
      const totalPeopleCount =
        allocatedCount > 0 || search.totalProcessed === 0
          ? durableAllocationCount
          : search.totalProcessed + addedCount;

      // 15. Update the search People count (extends the same search row).
      await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: {
          totalProcessed: totalPeopleCount,
          status: totalPeopleCount > 0 ? "READY" : search.status
        }
      });

      // "No more unique people available" = the provider is exhausted and this
      // run could not fill a full batch, so nothing remains for next time.
      const resultExhausted = exhausted && addedCount < this.batchSize;
      const completed = await this.completeExpansion(expansion.id, {
        addedCount,
        cacheCount,
        providerCount,
        totalPeopleCount,
        exhausted: resultExhausted
      });

      await this.safeAudit("DISCOVER_EXPANSION_COMPLETED", userId, actorEmail, searchId, {
        expansionId: expansion.id,
        requestedCount: this.batchSize,
        addedCount,
        cacheCount,
        providerCount,
        materializedCount: materialized.materializedCount,
        allocationAddedCount: addedCount,
        finalAllocationCount: durableAllocationCount,
        totalPeopleCount
      });

      // Use the remaining count from THIS reservation (no extra quota read).
      return this.toResult(completed, reservation.status.searchesRemaining, resultExhausted, null);
    } finally {
      if (!lockUnavailable) {
        try {
          await this.expansionLock.release(lockKey, lockToken);
        } catch {
          // Lock TTL/DB uniqueness protect correctness if Redis disappears.
        }
      }
    }
  }

  // -- internals --------------------------------------------------------------

  private async requireOwnedSearch(userId: string, searchId: string): Promise<ProspectSearch> {
    const search = await this.prisma.prospectSearch.findFirst({ where: { id: searchId, userId } });
    if (!search) {
      throw new ProspectError("NOT_FOUND", "Prospect search not found.");
    }
    return search;
  }

  private async findExpansion(searchId: string, idempotencyKey: string) {
    return this.prisma.discoverSearchExpansion.findFirst({ where: { searchId, idempotencyKey } });
  }

  private buildFingerprint(company: ProspectCompany, roles: string[], locations: string[]) {
    return computeDiscoverFingerprint({
      company: {
        linkedinCompanyUrl: company.linkedinUrl,
        officialWebsiteDomain: company.officialWebsiteDomain,
        officialDomain: company.officialDomain,
        normalizedName: company.normalizedName
      },
      roles,
      locations,
      resultLimit: resolveResultsPerSearch(),
      cacheVersion: resolveSharedCacheVersion()
    });
  }

  /**
   * The stable identities already GRANTED to this search (its allocation rows),
   * so an expansion never repeats them. A pre-allocation legacy search (no
   * grants) falls back to the old company-scoped set, which preserves the exact
   * pre-allocation behavior instead of re-adding people the user already sees.
   */
  private async loadExistingIdentities(
    userId: string,
    searchId: string,
    companyId: string
  ): Promise<{ identities: PersonIdentitySet; allocatedCount: number }> {
    const allocations = await this.prisma.prospectSearchPerson.findMany({ where: { searchId } });
    const people =
      allocations.length > 0
        ? await this.prisma.prospectPerson.findMany({
            where: { userId, id: { in: allocations.map((row) => row.personId) } }
          })
        : await this.prisma.prospectPerson.findMany({ where: { userId, companyId } });
    return {
      identities: new PersonIdentitySet(
        people.map((person) => ({ sourceProfileId: person.sourceProfileId, linkedinUrl: person.linkedinUrl }))
      ),
      allocatedCount: allocations.length
    };
  }

  private async loadReusableLocalCandidates(input: {
    userId: string;
    search: ProspectSearch;
    company: ProspectCompany;
    roles: string[];
    locations: string[];
  }): Promise<ResolvedCachePerson[]> {
    const rows = await this.prisma.prospectPerson.findMany({
      where: { userId: input.userId, companyId: input.company.id },
      include: { position: { select: { category: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const people: ResolvedCachePerson[] = rows.map((person) => ({
      sourceProfileId: person.sourceProfileId,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: person.fullName,
      ...nameStateFields(person),
      currentTitle: person.currentTitle,
      normalizedTitle: person.normalizedTitle,
      positionCategory: person.position.category,
      location: person.location,
      country: person.country,
      state: person.state,
      city: person.city,
      linkedinUrl: person.linkedinUrl,
      inferredEmail: person.inferredEmail,
      emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence,
      emailPattern: person.emailPattern,
      emailSource: person.emailSource
    }));
    return this.roleIntelligence.filterAndRankPeople({
      people,
      requestedTitles: input.roles,
      requestedLocations: input.locations,
      context: "CACHE",
      options: { budget: createAiBudget(), searchId: input.search.id }
    });
  }

  /**
   * Materialize cached unused people first; if still short and the provider is
   * not exhausted, continue the Apify search from its saved page under the shared
   * per-fingerprint lock (at most one provider continuation per canonical query).
   */
  private async collectNewPeople(params: {
    search: ProspectSearch;
    company: ProspectCompany;
    roles: string[];
    locations: string[];
    fingerprint: string;
    fingerprintInput: ReturnType<typeof computeDiscoverFingerprint>["input"];
    cacheCompany: DiscoverCacheCompany;
    cacheEmailFormat: ResolvedEmailFormat;
    identities: PersonIdentitySet;
    unusedCached: ResolvedCachePerson[];
    providerExhausted: boolean;
    userId: string;
    actorEmail: string | null;
  }): Promise<{ people: ResolvedCachePerson[]; cacheCount: number; providerCount: number; exhausted: boolean }> {
    const { identities } = params;
    const collected: ResolvedCachePerson[] = [];

    // 10. Materialize up to a full batch of unused cached people (no provider).
    for (const person of params.unusedCached) {
      if (collected.length >= this.batchSize) {
        break;
      }
      if (identities.addIfNew(person)) {
        collected.push(person);
      }
    }
    let cacheCount = collected.length;
    let providerCount = 0;
    let exhausted = params.providerExhausted;

    // A partial durable-DB batch intentionally ends this action. The next Add
    // More request may use the provider only after the user has exhausted every
    // matching permanent person.
    if (cacheCount > 0) {
      return { people: collected, cacheCount, providerCount: 0, exhausted };
    }

    // 11. No unused database people remain. Fetch at most one provider page for
    // this explicit action; never loop merely to force a full batch.
    if (!exhausted && this.maxProviderPages > 0) {
      const budget = createAiBudget();
      await this.cache.runWithProviderLock(params.fingerprint, async () => {
        // Re-check under the lock: another holder may have appended results while
        // we waited. Reuse anything newly available before fetching.
        const rechecked = await this.cache.getExpansionState(params.fingerprint);
        if (rechecked) {
          exhausted = rechecked.providerExhausted;
          const recheckedPeople = this.roleIntelligence.enabled
            ? await this.roleIntelligence.filterAndRankPeople({
                people: rechecked.people,
                requestedTitles: params.roles,
                requestedLocations: params.locations,
                context: "CACHE",
                options: { budget, searchId: params.search.id }
              })
            : rechecked.people;
          for (const person of recheckedPeople) {
            if (collected.length >= this.batchSize) {
              break;
            }
            if (identities.addIfNew(person)) {
              collected.push(person);
              cacheCount += 1;
            }
          }
        }

        if (cacheCount > 0 || exhausted) {
          return;
        }

        // A database-only initial search may have no exact continuation row. In
        // that case this explicit user action starts at page 1. When metadata
        // exists, always honor its saved next page (including old cache rows).
        const brightPage = rechecked?.brightNextPage ?? 1;
        const apifyPage = rechecked?.apifyNextPage ?? rechecked?.providerNextPage ?? 1;
        const cachedPeopleCount = rechecked?.people.length ?? 0;
        await this.safeAudit("DISCOVER_EXPANSION_PROVIDER_FETCH", params.userId, params.actorEmail, params.search.id, {
          brightPage,
          apifyPage,
          providerCalled: true,
          explicitExpansion: true,
          reason: "DATABASE_EXHAUSTED"
        });
        const providerExcluded = await this.loadProviderExcludedIdentities(
          params.userId,
          params.search.id,
          params.fingerprintInput.companyKey,
          params.company.officialWebsiteDomain ?? params.company.officialDomain,
          params.company.linkedinUrl
        );
        const chain = await this.providerOrchestrator.discover({
          companyName: params.company.officialName ?? params.company.name,
          companyLinkedinUrl: params.company.linkedinUrl,
          requestedTitles: params.roles,
          requestedLocations: params.locations,
          maxResults: PROVIDER_PAGE_SIZE,
          brightStartPage: brightPage,
          apifyStartPage: apifyPage,
          brightExhausted: rechecked?.brightExhausted ?? false,
          apifyExhausted: rechecked?.apifyExhausted ?? rechecked?.providerExhausted ?? false,
          excluded: providerExcluded,
          budget,
          searchId: params.search.id
        });
        let updated = rechecked;
        for (const contribution of chain.contributions) {
          updated = await this.cache.appendProviderPeople({
            fingerprint: params.fingerprint,
            fingerprintInput: params.fingerprintInput,
            company: params.cacheCompany,
            emailFormat: params.cacheEmailFormat,
            people: contribution.people,
            nextPage: contribution.nextPage,
            pagesFetched: contribution.pagesFetched,
            exhausted: contribution.exhausted,
            provider: contribution.provider,
            providerRunId: contribution.providerRunId,
            providerDatasetId: contribution.providerDatasetId
          });
        }
        if (!updated) return;
        const cacheAppendedCount = Math.max(0, updated.people.length - cachedPeopleCount);
        const collectedBeforePage = collected.length;
        for (const person of updated.people) {
          if (collected.length >= this.batchSize) break;
          if (identities.addIfNew(person)) {
            collected.push(person);
            providerCount += 1;
          }
        }
        const collectedCount = collected.length - collectedBeforePage;
        const brightExhausted = !this.providerOrchestrator.brightConfigured || (updated.brightExhausted ?? false);
        const apifyExhausted = updated.apifyExhausted ?? updated.providerExhausted;
        exhausted = brightExhausted && apifyExhausted;
        const apifyContribution = chain.contributions.find((entry) => entry.provider === "APIFY");
        await this.safeAudit("DISCOVER_EXPANSION_PROVIDER_PAGE_PROCESSED", params.userId, params.actorEmail, params.search.id, {
          page: apifyPage,
          brightPage,
          apifyPage,
          rawProviderCount: apifyContribution?.providerTotalFound ?? 0,
          normalizedProviderCount: apifyContribution?.providerResultCount ?? 0,
          identityResolvedCount: apifyContribution?.providerResultCount ?? 0,
          classifiedCount: apifyContribution?.providerResultCount ?? 0,
          semanticAcceptedCount: apifyContribution?.people.length ?? 0,
          semanticRejectedCount: Math.max(
            0,
            (apifyContribution?.providerResultCount ?? 0) - (apifyContribution?.people.length ?? 0)
          ),
          rawBrightResults: chain.diagnostics.bright?.rawBrightResults ?? 0,
          linkedInCandidates: chain.diagnostics.bright?.linkedInCandidates ?? 0,
          brightValidUnique: chain.diagnostics.brightValidUnique,
          apifyFallbackCalled: chain.diagnostics.apifyFallbackCalled,
          apifyNewUnique: chain.diagnostics.apifyNewUnique,
          cacheAppendedCount,
          duplicateCount: Math.max(0, chain.people.length - cacheAppendedCount),
          collectedCount,
          providerExhausted: exhausted
        });
      });
    }

    return { people: collected, cacheCount, providerCount, exhausted };
  }

  private async loadProviderExcludedIdentities(
    userId: string,
    searchId: string,
    companyCanonicalKey: string,
    companyDomainInput: string | null,
    companyLinkedinUrl: string | null
  ): Promise<PersonIdentitySet> {
    const prisma = this.prisma as any;
    const companyDomain = normalizeDomain(companyDomainInput);
    const companyLinkedinSlug = normalizeLinkedinCompanySlug(companyLinkedinUrl);
    const [publicPeople, allocations] = await Promise.all([
      prisma.discoverPublicPerson.findMany({
        where: {
          OR: [
            { companyCanonicalKey },
            ...(companyDomain ? [{ companyDomain }] : []),
            ...(companyLinkedinSlug ? [{ companyLinkedinSlug }] : [])
          ]
        },
        select: { sourceProfileId: true, linkedinUrl: true }
      }),
      this.prisma.prospectSearchPerson.findMany({ where: { searchId }, select: { personId: true } })
    ]);
    const allocatedPeople = allocations.length
      ? await this.prisma.prospectPerson.findMany({
          where: { userId, id: { in: allocations.map((row) => row.personId) } },
          select: { sourceProfileId: true, linkedinUrl: true }
        })
      : [];
    return new PersonIdentitySet([...publicPeople, ...allocatedPeople]);
  }

  /**
   * Add the collected new people to the user's own records (positions + people),
   * regenerating each email from the user's selected company format (so a manual
   * override is honored), and record each one as an allocation grant on the
   * TARGET search only — an expansion never adds people to the user's other role
   * searches for the same company. Returns how many grants were genuinely added.
   * Uniqueness is enforced server-side by the ProspectPerson
   * (userId, sourceProfileId) key and the ProspectSearchPerson
   * (searchId, personId) key.
   */
  private async materializePeople(
    userId: string,
    search: ProspectSearch,
    company: ProspectCompany,
    people: ResolvedCachePerson[],
    allocation: { cacheCount: number; allocationOrderBase: number }
  ): Promise<{ materializedCount: number; allocationAddedCount: number }> {
    if (people.length === 0) {
      return { materializedCount: 0, allocationAddedCount: 0 };
    }

    people = await normalizeDiscoverPersonNames(people, { companyName: company.officialName ?? company.name });
    const categories = new Map<PositionCategory, Set<string>>();
    for (const person of people) {
      const category = coercePositionCategory(person.positionCategory);
      if (!categories.has(category)) {
        categories.set(category, new Set());
      }
      if (person.currentTitle) {
        categories.get(category)!.add(person.currentTitle);
      }
    }

    const positionMap = new Map<PositionCategory, string>();
    for (const [category, titles] of categories) {
      const existing = await this.prisma.prospectCompanyPosition.findFirst({
        where: { companyId: company.id, category }
      });
      const merged = new Set<string>([...asStringArray(existing?.rawTitles), ...titles]);
      const position = await this.prisma.prospectCompanyPosition.upsert({
        where: { companyId_category: { companyId: company.id, category } },
        create: {
          companyId: company.id,
          category,
          displayName: displayNameForCategory(category),
          rawTitles: Array.from(merged)
        },
        update: { displayName: displayNameForCategory(category), rawTitles: Array.from(merged) }
      });
      positionMap.set(category, position.id);
    }

    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const existingPeople = await this.prisma.prospectPerson.findMany({
      where: { userId, sourceProfileId: { in: people.map((person) => person.sourceProfileId) } }
    });
    const existingByProfileId = new Map(existingPeople.map((person) => [person.sourceProfileId, person]));
    const originals = people.map(p => existingByProfileId.get(p.sourceProfileId) ?? p);
    const correctedEmails = people.map((p, i) => {
      const named = { ...originals[i], firstName: p.firstName, lastName: p.lastName, fullName: p.fullName, ...nameStateFields(p) };
      return { ...p, ...resolveProspectPersonEmail(named, company, { allowLowConfidence: false, regenerateExistingInferred: true }) };
    });
    const protectedPeople = await protectNameRepairSuppressions(this.prisma, userId, originals, correctedEmails);
    const emailByProfile = new Map(protectedPeople.map(p => [p.sourceProfileId, p]));


    let materializedCount = 0;
    let allocationAddedCount = 0;
    for (const [index, person] of people.entries()) {
      const category = coercePositionCategory(person.positionCategory);
      const positionId = positionMap.get(category) ?? positionMap.get("OTHER");
      if (!positionId) {
        continue;
      }
      // New/eligible people use the canonical company format. Existing
      // verified/trusted addresses are preserved; a generated address that has
      // since failed is not — the failure stays on that address in the
      // suppression list and is overlaid at read time.
      const protectedPerson = emailByProfile.get(person.sourceProfileId)!;
      const emailFields = {
        inferredEmail: protectedPerson.inferredEmail, emailStatus: protectedPerson.emailStatus,
        emailConfidence: protectedPerson.emailConfidence, emailPattern: protectedPerson.emailPattern,
        emailSource: protectedPerson.emailSource
      };
      const fields = {
        companyId: company.id,
        positionId,
        firstName: person.firstName,
        lastName: person.lastName,
        fullName: person.fullName,
      ...nameStateFields(person),
        currentTitle: person.currentTitle,
        normalizedTitle: person.normalizedTitle,
        location: person.location,
        country: person.country,
        state: person.state,
        city: person.city,
        linkedinUrl: person.linkedinUrl,
        ...emailFields
      };
      const materialized = await this.prisma.prospectPerson.upsert({
        where: { userId_sourceProfileId: { userId, sourceProfileId: person.sourceProfileId } },
        create: { userId, sourceProfileId: person.sourceProfileId, ...fields },
        update: fields
      });
      materializedCount += 1;
      // Grant the person to the TARGET search. `allocationAddedCount` counts new grants, so a
      // concurrent duplicate (converged by the unique key) is never counted twice.
      const existingGrant = await this.prisma.prospectSearchPerson.findFirst({
        where: { searchId: search.id, personId: materialized.id }
      });
      await this.prisma.prospectSearchPerson.upsert({
        where: { searchId_personId: { searchId: search.id, personId: materialized.id } },
        create: {
          searchId: search.id,
          personId: materialized.id,
          userId,
          allocationOrder: allocation.allocationOrderBase + index,
          allocationSource: index < allocation.cacheCount ? "ADD_MORE_CACHE" : "ADD_MORE_PROVIDER"
        },
        update: {}
      });
      if (!existingGrant) {
        allocationAddedCount += 1;
      }
    }
    return { materializedCount, allocationAddedCount };
  }

  private companyEmailFormat(company: ProspectCompany): ResolvedEmailFormat {
    return {
      emailDomain: company.emailDomain,
      emailDomainConfidence: company.emailDomainConfidence,
      emailDomainEvidence: company.emailDomainEvidence ?? null,
      emailPattern: company.emailPattern,
      patternConfidence: company.patternConfidence,
      patternEvidence: company.patternEvidence ?? null,
      emailFormatReason: company.emailFormatReason
    };
  }

  private async completeExpansion(
    expansionId: string,
    data: {
      addedCount: number;
      cacheCount: number;
      providerCount: number;
      totalPeopleCount: number;
      exhausted: boolean;
    }
  ) {
    return this.prisma.discoverSearchExpansion.update({
      where: { id: expansionId },
      data: {
        status: "READY",
        addedCount: data.addedCount,
        cacheCount: data.cacheCount,
        providerCount: data.providerCount,
        totalPeopleCount: data.totalPeopleCount,
        exhausted: data.exhausted,
        errorCode: null,
        completedAt: this.now()
      }
    });
  }

  private async quotaRemaining(userId: string, actorEmail: string | null): Promise<number> {
    const status = await this.quotaStatus(userId, actorEmail);
    return status.searchesRemaining;
  }

  private toResult(
    expansion: {
      id: string;
      searchId: string;
      status: string;
      requestedCount: number;
      addedCount: number;
      totalPeopleCount: number;
      exhausted: boolean;
    },
    quotaRemaining: number,
    exhausted: boolean,
    message: string | null
  ): DiscoverExpansionResult {
    const resolvedMessage = message ?? expansionMessage(expansion.addedCount, this.batchSize, exhausted);
    return {
      id: expansion.id,
      searchId: expansion.searchId,
      status: (expansion.status as ExpansionStatus) ?? "READY",
      requestedCount: expansion.requestedCount,
      addedCount: expansion.addedCount,
      totalPeopleCount: expansion.totalPeopleCount,
      quotaRemaining,
      exhausted,
      message: resolvedMessage
    };
  }

  private async safeAudit(
    action: string,
    userId: string,
    actorEmail: string | null,
    searchId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.audit({
        actor: { id: userId, email: actorEmail ?? "unknown" },
        action,
        category: "SYSTEM",
        target: { type: "ProspectSearch", id: searchId },
        // Only safe counters are ever stored — never people, emails, or payloads.
        metadata: { searchId, ...metadata }
      });
    } catch {
      // Audit is best-effort and must never break the expansion.
    }
  }
}

export const NO_MORE_PEOPLE_MESSAGE = "No more people were found.";

/** The success/result message for an expansion outcome. */
export function expansionMessage(addedCount: number, batchSize: number, exhausted: boolean): string {
  if (addedCount === 0) {
    return NO_MORE_PEOPLE_MESSAGE;
  }
  if (addedCount >= batchSize) {
    return `${addedCount} new people were added.`;
  }
  if (exhausted) {
    return `${addedCount} new people were added. No more unique people are available for this search.`;
  }
  return `${addedCount} new people were added. No other unique matches were available in this batch.`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_]{1,64}$/.test(code)) {
      return code;
    }
  }
  return "PROVIDER_ERROR";
}
