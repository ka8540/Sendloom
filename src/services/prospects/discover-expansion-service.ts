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
import { ApifyProfileSearchService, type NormalizedProfile } from "@/services/prospects/apify-profile-search";
import {
  DiscoverSearchCacheService,
  createRedisCacheLock,
  resolveSharedCacheVersion,
  type DiscoverCacheCompany,
  type DiscoverCacheExpansionPort,
  type DiscoverCacheLock,
  type ResolvedCachePerson,
  type ResolvedEmailFormat
} from "@/services/prospects/discover-cache-service";
import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { AiCallBudget, createAiBudget } from "@/services/prospects/prospect-ai";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
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
  /** Defaults to the shared 30-day result cache (provides continuation state). */
  cache?: DiscoverCacheExpansionPort;
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
  private readonly apify: ApifyProfileSearchService;
  private readonly roleClassifier: RoleClassificationService;
  private readonly cache: DiscoverCacheExpansionPort;
  private readonly discoverQuota: DiscoverQuotaReserver;
  private readonly quotaStatus: (userId: string, email: string | null) => Promise<DiscoverQuotaStatus>;
  private readonly expansionLock: DiscoverCacheLock;
  private readonly now: () => Date;
  private readonly audit: ExpansionAuditFn;
  private readonly batchSize: number;
  private readonly maxProviderPages: number;

  constructor(deps: DiscoverExpansionServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.roleClassifier = deps.roleClassifier;
    this.cache = deps.cache ?? new DiscoverSearchCacheService({ prisma: deps.prisma });
    this.discoverQuota = deps.discoverQuota ?? reserveDiscoverSearchSlot;
    this.quotaStatus = deps.quotaStatus ?? getDiscoverQuotaStatus;
    this.expansionLock = deps.expansionLock ?? createRedisCacheLock();
    this.now = deps.now ?? (() => new Date());
    this.audit = deps.audit ?? recordAuditEvent;
    this.batchSize = deps.batchSize ?? resolveExpansionBatchSize();
    this.maxProviderPages = deps.maxProviderPages ?? resolveExpansionMaxProviderPages();
  }

  async addMorePeople(input: AddMorePeopleInput): Promise<DiscoverExpansionResult> {
    const { userId, actorEmail, searchId, idempotencyKey } = input;

    // 1-5. Authenticate (done in the resolver), load + own the search, confirm it
    // is READY and has the canonical company / roles / locations to continue.
    const search = await this.requireOwnedSearch(userId, searchId);
    if (search.status !== "READY") {
      throw new ProspectError("INVALID_STATE", "Only a ready search can add more people.");
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
    const lockToken = await this.expansionLock.acquire(lockKey);
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

      // 9. Look at the fresh shared cache for unused matching people.
      const cacheState = await this.cache.getExpansionState(fingerprint);
      const unusedCached = cacheState ? cacheState.people.filter((person) => !identities.has(person)) : [];
      const providerExhausted = cacheState?.providerExhausted ?? false;

      // Early no-op: provider already exhausted and nothing unused remains. Do
      // not consume a daily slot for a request that cannot add anyone.
      if (providerExhausted && unusedCached.length === 0) {
        const remaining = await this.quotaRemaining(userId, actorEmail);
        const completed = await this.completeExpansion(expansion.id, {
          addedCount: 0,
          cacheCount: 0,
          providerCount: 0,
          totalPeopleCount: search.totalProcessed,
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

      const addedCount = await this.materializePeople(userId, search, company, toAdd, {
        cacheCount,
        allocationOrderBase: allocatedCount
      });
      const totalPeopleCount = search.totalProcessed + addedCount;

      // 15. Update the search People count (extends the same search row).
      await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: { totalProcessed: totalPeopleCount }
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
        totalPeopleCount
      });

      // Use the remaining count from THIS reservation (no extra quota read).
      return this.toResult(completed, reservation.status.searchesRemaining, resultExhausted, null);
    } finally {
      await this.expansionLock.release(lockKey, lockToken);
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
    const cacheCount = collected.length;
    let providerCount = 0;
    let exhausted = params.providerExhausted;

    // 11. Continue the provider only if we still need more and it isn't exhausted.
    if (collected.length < this.batchSize && !exhausted) {
      const budget = createAiBudget();
      await this.cache.runWithProviderLock(params.fingerprint, async () => {
        // Re-check under the lock: another holder may have appended results while
        // we waited. Reuse anything newly available before fetching.
        const rechecked = await this.cache.getExpansionState(params.fingerprint);
        if (rechecked) {
          exhausted = rechecked.providerExhausted;
          for (const person of rechecked.people) {
            if (collected.length >= this.batchSize) {
              break;
            }
            if (identities.addIfNew(person)) {
              collected.push(person);
              providerCount += 1;
            }
          }
        }

        // The initial search consumed provider page 1, so continuation defaults
        // to page 2 when no saved page exists. It never restarts at page 1.
        let page = rechecked?.providerNextPage ?? 2;
        let pagesFetched = 0;

        while (collected.length < this.batchSize && pagesFetched < this.maxProviderPages && !exhausted) {
          await this.safeAudit("DISCOVER_EXPANSION_PROVIDER_FETCH", params.userId, params.actorEmail, params.search.id, {
            page
          });
          // 14. Continue from the saved provider page — never restart at page 1.
          const pageResult = await this.apify.searchProfiles({
            companyName: params.company.officialName ?? params.company.name,
            companyLinkedinUrl: params.company.linkedinUrl,
            jobTitles: params.roles,
            locations: params.locations,
            maxResults: PROVIDER_PAGE_SIZE,
            startPage: page
          });
          pagesFetched += 1;
          const nextPage = page + 1;
          // A page with no raw provider items means there are no further pages.
          const pageExhausted = pageResult.totalFound === 0;
          const pagePeople = await this.buildProviderPeople(
            pageResult.profiles,
            params.cacheEmailFormat,
            params.search.id,
            budget
          );

          // 13-14. Append net-new normalized results to the shared cache and
          // advance the saved continuation page (only after a valid fetch).
          const updated = await this.cache.appendProviderPeople({
            fingerprint: params.fingerprint,
            fingerprintInput: params.fingerprintInput,
            company: params.cacheCompany,
            emailFormat: params.cacheEmailFormat,
            people: pagePeople,
            nextPage,
            pagesFetched: 1,
            exhausted: pageExhausted
          });

          page = nextPage;
          if (pageExhausted) {
            exhausted = true;
          }

          for (const person of updated.people) {
            if (collected.length >= this.batchSize) {
              break;
            }
            if (identities.addIfNew(person)) {
              collected.push(person);
              providerCount += 1;
            }
          }
        }

        if (exhausted) {
          await this.cache.markProviderExhausted(params.fingerprint);
        }
      });
    }

    return { people: collected, cacheCount, providerCount, exhausted };
  }

  /**
   * Classify titles (role groups) and build normalized cache people for a freshly
   * fetched provider page. Emails use the shared evidence-backed format (never a
   * per-user manual override, which must never enter the shared cache). The
   * email-format AI is never re-run here.
   */
  private async buildProviderPeople(
    profiles: NormalizedProfile[],
    emailFormat: ResolvedEmailFormat,
    searchId: string,
    budget: AiCallBudget
  ): Promise<ResolvedCachePerson[]> {
    // 24. New people go through the existing role-classification process.
    const rawTitles = profiles
      .map((profile) => profile.currentTitle)
      .filter((title): title is string => Boolean(title));
    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId });

    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(emailFormat.emailDomainConfidence, emailFormat.patternConfidence);

    return profiles.map((profile) => {
      const category = categoryForProfile(profile, classifications);
      const candidate = resolveCandidateEmail({
        firstName: profile.firstName,
        lastName: profile.lastName,
        domain: emailFormat.emailDomain,
        pattern: emailFormat.emailPattern,
        patternConfidence: candidateConfidence,
        allowLowConfidence
      });
      return {
        sourceProfileId: profile.sourceProfileId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        fullName: profile.fullName,
        currentTitle: profile.currentTitle,
        normalizedTitle: profile.normalizedTitle,
        positionCategory: category,
        location: profile.location,
        country: profile.country,
        state: profile.state,
        city: profile.city,
        linkedinUrl: profile.linkedinUrl,
        inferredEmail: candidate.email,
        emailStatus: candidate.status,
        emailConfidence: candidate.confidence,
        emailPattern: candidate.email ? emailFormat.emailPattern : null,
        emailSource: candidate.email ? "PATTERN" : null
      };
    });
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
  ): Promise<number> {
    if (people.length === 0) {
      return 0;
    }

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
    const candidateConfidence = combinedEmailConfidence(company.emailDomainConfidence, company.patternConfidence);

    let added = 0;
    for (const [index, person] of people.entries()) {
      const category = coercePositionCategory(person.positionCategory);
      const positionId = positionMap.get(category) ?? positionMap.get("OTHER");
      if (!positionId) {
        continue;
      }
      // 25. New people receive the existing inferred-email processing: the
      // selected company domain + pattern, deterministic, never VERIFIED.
      const candidate = resolveCandidateEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        domain: company.emailDomain,
        pattern: company.emailPattern,
        patternConfidence: candidateConfidence,
        allowLowConfidence
      });
      const fields = {
        companyId: company.id,
        positionId,
        firstName: person.firstName,
        lastName: person.lastName,
        fullName: person.fullName,
        currentTitle: person.currentTitle,
        normalizedTitle: person.normalizedTitle,
        location: person.location,
        country: person.country,
        state: person.state,
        city: person.city,
        linkedinUrl: person.linkedinUrl,
        inferredEmail: candidate.email,
        emailStatus: candidate.status,
        emailConfidence: candidate.confidence,
        emailPattern: candidate.email ? company.emailPattern : null,
        emailSource: candidate.email ? "PATTERN" : null
      };
      const materialized = await this.prisma.prospectPerson.upsert({
        where: { userId_sourceProfileId: { userId, sourceProfileId: person.sourceProfileId } },
        create: { userId, sourceProfileId: person.sourceProfileId, ...fields },
        update: fields
      });
      // Grant the person to the TARGET search. `added` counts new grants, so a
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
        added += 1;
      }
    }
    return added;
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

export const NO_MORE_PEOPLE_MESSAGE = "No additional unique people were found for this search.";

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

function categoryForProfile(
  profile: NormalizedProfile,
  classifications: Map<string, { category: PositionCategory }>
): PositionCategory {
  const normalized = profile.normalizedTitle ?? (profile.currentTitle ? normalizeTitle(profile.currentTitle) : "");
  const classification = normalized ? classifications.get(normalized) : undefined;
  return classification ? coercePositionCategory(classification.category) : "OTHER";
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
