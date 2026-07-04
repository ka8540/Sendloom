import { randomUUID } from "node:crypto";

import type { PrismaClient, ProspectCompany, ProspectSearch } from "@prisma/client";

import { type RecordAuditEventArgs } from "@/lib/audit";
import {
  buildEmailFormatCacheKey,
  parseEmailFormatDecisionMetadata,
  serializeEmailFormatDecisionMetadata
} from "@/lib/email-format-decision";
import { discoverPublicErrorCategory } from "@/lib/discover-public-error";
import {
  formatDiscoverLimitMessage,
  resolveResultsPerSearch,
  reserveDiscoverSearchSlot,
  type DiscoverQuotaReserver
} from "@/lib/discover-quota";
import { env } from "@/lib/env";
import {
  type ConfidenceLevel,
  type PositionCategory,
  coercePositionCategory,
  displayNameForCategory,
  isConfidenceLevel,
  isEmailPattern
} from "@/lib/prospect-enums";
import {
  ApifyProfileSearchService,
  type NormalizedProfile
} from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService, type CompanyResolution } from "@/services/prospects/company-resolution-service";
import {
  DiscoverSearchCacheService,
  resolveSharedCacheVersion,
  type DiscoverCachePort,
  type ResolvedCachePerson,
  type ResolvedDataset
} from "@/services/prospects/discover-cache-service";
import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import {
  EmailDomainService,
  type EmailDomainEvidence,
  type EmailPatternEvidence,
  isAllowedBusinessEmailDomain,
  makeManualEmailDomainEvidence
} from "@/services/prospects/email-domain-service";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import {
  DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL,
  isOpenAIEmailFormatDiscoveryConfigured
} from "@/services/prospects/openai-email-format-discovery";
import { AiCallBudget, createAiBudget } from "@/services/prospects/prospect-ai";
import { normalizeDomain, normalizeTitle } from "@/services/prospects/prospect-normalization";
import { rateLimit } from "@/lib/rate-limit";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { ValidatedCreateProspectSearch } from "@/services/prospects/prospect-validation";

export type ProspectErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "COMPANY_UNRESOLVED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "DISCOVER_DAILY_LIMIT_REACHED"
  | "DISCOVER_EXPANSION_ALREADY_RUNNING"
  | "DISCOVER_EXPANSION_FAILED";

export class ProspectError extends Error {
  code: ProspectErrorCode;

  constructor(code: ProspectErrorCode, message: string) {
    super(message);
    this.name = "ProspectError";
    this.code = code;
  }
}

const TERMINAL_STATUSES = new Set(["READY", "CANCELED"]);
const DEFAULT_PIPELINE_TIMEOUT_MS = 120_000;
// Company-level structured email-format evidence stays fresh for 30 days.
const EMAIL_FORMAT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_FORMAT_REFRESH_IN_FLIGHT = new Map<string, Promise<ProspectCompany>>();

function hasConfiguredEmailFormatSearchProvider(): boolean {
  if (env.WEB_SEARCH_PROVIDER === "serper") {
    return Boolean(env.SERPER_API_KEY);
  }
  if (env.WEB_SEARCH_PROVIDER === "brave") {
    return Boolean(env.BRAVE_SEARCH_API_KEY);
  }
  return false;
}

/** True when any email-format discovery path (AI web search or legacy provider) is usable. */
function hasConfiguredEmailFormatDiscovery(): boolean {
  return isOpenAIEmailFormatDiscoveryConfigured() || hasConfiguredEmailFormatSearchProvider();
}

/** A company has a usable, fresh, high-confidence format already on file. */
function isFreshHighConfidenceFormat(company: ProspectCompany): boolean {
  if (!company.emailDomain || !company.emailPattern) {
    return false;
  }
  if (company.emailDomainConfidence !== "HIGH" || company.patternConfidence !== "HIGH") {
    return false;
  }
  const discoveredAt = company.emailFormatDiscoveredAt;
  if (!discoveredAt) {
    return false;
  }
  if (Date.now() - new Date(discoveredAt).getTime() >= EMAIL_FORMAT_CACHE_TTL_MS) {
    return false;
  }
  const metadata = parseEmailFormatDecisionMetadata(company.emailFormatReason);
  if (!metadata) {
    // Historical cached results remain compatible; new structured results also
    // validate their normalized identity below.
    return true;
  }
  return metadata.cacheKey === buildEmailFormatCacheKey({
    companyName: company.officialName ?? company.name,
    websiteDomain: company.officialWebsiteDomain ?? company.officialDomain,
    emailDomain: company.emailDomain
  });
}

function hasFreshStoredEmailEvidence(company: ProspectCompany) {
  if (!company.emailFormatDiscoveredAt) {
    return false;
  }
  if (Date.now() - new Date(company.emailFormatDiscoveredAt).getTime() >= EMAIL_FORMAT_CACHE_TTL_MS) {
    return false;
  }
  return (
    (Array.isArray(company.emailDomainEvidence) && company.emailDomainEvidence.length > 0) ||
    (Array.isArray(company.patternEvidence) && company.patternEvidence.length > 0)
  );
}

export type EmailFormatRateLimit = { allowed: boolean; retryAfterSeconds: number };
export type EmailFormatRateLimiter = (userId: string) => Promise<EmailFormatRateLimit>;

/** Default per-user cost control: both an hourly and a daily window must allow. */
async function defaultEmailFormatRateLimiter(userId: string): Promise<EmailFormatRateLimit> {
  const hourly = await rateLimit({
    key: `prospect-email-format-ai:hour:${userId}`,
    limit: env.PROSPECT_EMAIL_FORMAT_AI_HOURLY_LIMIT,
    windowSeconds: 3600
  });
  if (!hourly.allowed) {
    return { allowed: false, retryAfterSeconds: hourly.retryAfterSeconds };
  }
  const daily = await rateLimit({
    key: `prospect-email-format-ai:day:${userId}`,
    limit: env.PROSPECT_EMAIL_FORMAT_AI_DAILY_LIMIT,
    windowSeconds: 86_400
  });
  return { allowed: daily.allowed, retryAfterSeconds: daily.retryAfterSeconds };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Safe audit sink (defaults to a no-op so unit tests never touch the audit DB). */
export type ProspectAuditFn = (args: RecordAuditEventArgs) => Promise<void> | void;
const noopAudit: ProspectAuditFn = () => undefined;

export type ProspectSearchServiceDeps = {
  prisma: PrismaClient;
  apify: ApifyProfileSearchService;
  companyResolution: CompanyResolutionService;
  roleClassifier: RoleClassificationService;
  emailDomain: EmailDomainService;
  pipelineTimeoutMs?: number;
  /** Injectable for tests; defaults to the Redis-backed per-user limiter. */
  emailFormatRateLimiter?: EmailFormatRateLimiter;
  /** Injectable for tests; defaults to the Redis-backed atomic daily quota. */
  discoverQuota?: DiscoverQuotaReserver;
  /** Injectable for tests; defaults to the shared 30-day result cache. */
  discoverCache?: DiscoverCachePort;
  /** Audit sink; defaults to a no-op (production wires recordAuditEvent). */
  audit?: ProspectAuditFn;
  /** Injectable clock for deterministic attempt timestamps in tests. */
  now?: () => Date;
};

/** Options for processSearch — the actor email is resolved from the session. */
export type ProcessSearchOptions = {
  /** Authenticated account email (session-resolved) for the quota exemption. */
  actorEmail?: string | null;
  /**
   * Client-generated idempotency key. A fresh key per deliberate Retry click is a
   * NEW processing attempt; a network/browser replay of the SAME key reuses the
   * current attempt (so it is never double-counted). Omitted callers get a
   * server-generated per-call attempt id.
   */
  idempotencyKey?: string | null;
};

/** Internal, privacy-safe outcome of one processing run (never returned to the API). */
type RunPipelineResult = {
  search: ProspectSearch;
  providerCalled: boolean;
  resultCount: number;
  cacheHit: boolean;
};

export class ProspectSearchService {
  private readonly prisma: PrismaClient;
  private readonly apify: ApifyProfileSearchService;
  private readonly companyResolution: CompanyResolutionService;
  private readonly roleClassifier: RoleClassificationService;
  private readonly emailDomain: EmailDomainService;
  private readonly pipelineTimeoutMs: number;
  private readonly emailFormatRateLimiter: EmailFormatRateLimiter;
  private readonly discoverQuota: DiscoverQuotaReserver;
  private readonly discoverCache: DiscoverCachePort;
  private readonly audit: ProspectAuditFn;
  private readonly now: () => Date;

  constructor(deps: ProspectSearchServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.companyResolution = deps.companyResolution;
    this.roleClassifier = deps.roleClassifier;
    this.emailDomain = deps.emailDomain;
    this.pipelineTimeoutMs = deps.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS;
    this.emailFormatRateLimiter = deps.emailFormatRateLimiter ?? defaultEmailFormatRateLimiter;
    this.discoverQuota = deps.discoverQuota ?? reserveDiscoverSearchSlot;
    this.discoverCache = deps.discoverCache ?? new DiscoverSearchCacheService({ prisma: deps.prisma });
    this.audit = deps.audit ?? noopAudit;
    this.now = deps.now ?? (() => new Date());
  }

  async createSearch(userId: string, input: ValidatedCreateProspectSearch): Promise<ProspectSearch> {
    return this.prisma.prospectSearch.create({
      data: {
        userId,
        requestedCompany: input.companyName,
        requestedDomain: input.companyDomain,
        requestedLinkedin: input.companyLinkedinUrl,
        requestedTitles: input.jobTitles,
        requestedLocations: input.locations,
        // Always the server-fixed value — the user-supplied count is discarded
        // so the persisted record can never authorize a larger run later.
        maxResults: resolveResultsPerSearch(),
        status: "DRAFT"
      }
    });
  }

  private async requireOwnedSearch(userId: string, searchId: string): Promise<ProspectSearch> {
    const search = await this.prisma.prospectSearch.findFirst({ where: { id: searchId, userId } });
    if (!search) {
      throw new ProspectError("NOT_FOUND", "Prospect search not found.");
    }
    return search;
  }

  private async requireOwnedCompany(userId: string, companyId: string): Promise<ProspectCompany> {
    const company = await this.prisma.prospectCompany.findFirst({ where: { id: companyId, userId } });
    if (!company) {
      throw new ProspectError("NOT_FOUND", "Company not found.");
    }
    return company;
  }

  async cancelSearch(userId: string, searchId: string): Promise<ProspectSearch> {
    const search = await this.requireOwnedSearch(userId, searchId);
    if (search.status === "CANCELED") {
      return search;
    }
    if (search.status === "READY") {
      throw new ProspectError("INVALID_STATE", "A completed search cannot be canceled.");
    }
    return this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: { status: "CANCELED", completedAt: new Date() }
    });
  }

  async deleteCompany(userId: string, companyId: string): Promise<boolean> {
    const company = await this.requireOwnedCompany(userId, companyId);

    await this.prisma.prospectSearch.deleteMany({ where: { userId, companyId: company.id } });
    await this.prisma.prospectPerson.deleteMany({ where: { userId, companyId: company.id } });
    await this.prisma.prospectCompanyPosition.deleteMany({ where: { companyId: company.id } });
    await this.prisma.prospectCompany.delete({ where: { id: company.id } });

    return true;
  }

  /**
   * Delete a single Search History entry the user owns. This removes ONLY the
   * ProspectSearch row (its expansion records cascade via the DB FK); the
   * materialized company/people remain and stay removable from the detail page's
   * company delete. Ownership is enforced first, and the delete is additionally
   * scoped to `{ id, userId }`, so a user can never delete another user's search
   * (a non-owned id reads as not-found, never revealing it exists).
   */
  async deleteSearch(userId: string, searchId: string): Promise<boolean> {
    await this.requireOwnedSearch(userId, searchId);
    await this.prisma.prospectSearch.deleteMany({ where: { id: searchId, userId } });
    return true;
  }

  /**
   * Run the full discovery pipeline for a search. Ownership / not-found errors
   * throw; provider/AI failures are persisted as a FAILED search and returned so
   * the caller can surface a structured failure (status + errorCode).
   *
   * The daily Discover quota is reserved atomically AFTER ownership/state
   * validation and BEFORE the paid pipeline starts. Reservation is idempotent
   * per search id, so retrying the same search (double-click, network retry,
   * refresh, or re-processing a FAILED search) never consumes a second slot.
   */
  async processSearch(
    userId: string,
    searchId: string,
    options: ProcessSearchOptions = {}
  ): Promise<ProspectSearch> {
    const search = await this.requireOwnedSearch(userId, searchId);

    if (search.status === "READY") {
      return search;
    }
    // A FAILED search is intentionally NOT terminal — retrying it re-runs the
    // whole pipeline against the SAME record (no duplicate Search History row).
    if (TERMINAL_STATUSES.has(search.status)) {
      throw new ProspectError("INVALID_STATE", `A ${search.status} search cannot be processed.`);
    }

    // Quota is reserved before the paid pipeline and is idempotent per search id:
    // retrying a FAILED search (or a network replay) never consumes a second slot.
    const reservation = await this.discoverQuota({
      userId,
      email: options.actorEmail ?? null,
      searchId: search.id
    });
    if (!reservation.allowed) {
      throw new ProspectError("DISCOVER_DAILY_LIMIT_REACHED", formatDiscoverLimitMessage(reservation.status));
    }

    // Processing-attempt bookkeeping. A genuine user-triggered retry (a fresh
    // idempotency key, or no key) becomes a NEW attempt; a replay of the same key
    // reuses the in-flight attempt so a duplicated network request is never
    // counted (or processed) twice.
    const previousStatus = search.status;
    const isRetry = previousStatus === "FAILED";
    const requestedKey = options.idempotencyKey?.trim() || null;
    const isReplay = requestedKey !== null && search.lastAttemptId === requestedKey;
    const attemptId = isReplay ? search.lastAttemptId! : requestedKey ?? randomUUID();
    const attemptNumber = isReplay ? search.attemptCount ?? 0 : (search.attemptCount ?? 0) + 1;
    const startedAtMs = this.now().getTime();

    if (!isReplay) {
      await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: {
          attemptCount: attemptNumber,
          lastAttemptId: attemptId,
          lastAttemptStartedAt: this.now(),
          lastAttemptCompletedAt: null
        }
      });
    }

    await this.safeAudit(isRetry ? "discover.retry_started" : "discover.search_started", userId, options.actorEmail, search.id, {
      attemptId,
      attemptNumber,
      previousStatus,
      isReplay
    });

    const budget = createAiBudget();

    try {
      const outcome = await withTimeout(
        this.runPipeline(userId, search, budget),
        this.pipelineTimeoutMs,
        () => new ProspectError("PROVIDER_TIMEOUT", "The profile search timed out. Try again in a moment.")
      );
      const completed = await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: { lastAttemptCompletedAt: this.now() }
      });
      this.logProcessingEvent({
        searchId: search.id,
        userId,
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus: "READY",
        cacheHit: outcome.cacheHit,
        providerCalled: outcome.providerCalled,
        providerResultCount: outcome.resultCount,
        errorCategory: null,
        retryable: false,
        durationMs: this.now().getTime() - startedAtMs
      });
      await this.safeAudit(isRetry ? "discover.retry_completed" : "discover.search_completed", userId, options.actorEmail, search.id, {
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus: "READY",
        providerCalled: outcome.providerCalled,
        resultCount: outcome.resultCount
      });
      return completed;
    } catch (error) {
      // The raw internal code/message is persisted for server-side diagnostics
      // only — the GraphQL layer maps it to a safe public category before it ever
      // reaches a user.
      const code = error instanceof ProspectError ? error.code : "PROVIDER_ERROR";
      const message = error instanceof Error ? error.message : "Prospect search failed.";
      const failureCategory = discoverPublicErrorCategory(code);
      const failed = await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: {
          status: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 500),
          completedAt: this.now(),
          lastAttemptCompletedAt: this.now()
        }
      });
      this.logProcessingEvent({
        searchId: search.id,
        userId,
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus: "FAILED",
        cacheHit: false,
        providerCalled: null,
        providerResultCount: 0,
        errorCategory: failureCategory,
        retryable: true,
        durationMs: this.now().getTime() - startedAtMs
      });
      await this.safeAudit(isRetry ? "discover.retry_failed" : "discover.search_failed", userId, options.actorEmail, search.id, {
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus: "FAILED",
        failureCategory
      });
      return failed;
    }
  }

  /**
   * Best-effort, privacy-safe audit event for one processing attempt. Stores only
   * safe counters/categories (never people, emails, raw provider payloads, or raw
   * internal error text). Never throws — auditing must not break a search.
   */
  private async safeAudit(
    action: string,
    userId: string,
    actorEmail: string | null | undefined,
    searchId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.audit({
        actor: { id: userId, email: actorEmail ?? "unknown" },
        action,
        category: "SYSTEM",
        target: { type: "ProspectSearch", id: searchId },
        metadata: { searchId, ...metadata }
      });
    } catch {
      // Audit is best-effort and must never break processing.
    }
  }

  /** Structured, privacy-safe per-attempt diagnostics (server logs only). */
  private logProcessingEvent(event: DiscoverProcessingLogEvent): void {
    logDiscoverProcessingEvent(event);
  }

  private async setStatus(searchId: string, status: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.prisma.prospectSearch.update({ where: { id: searchId }, data: { status, ...data } });
  }

  private async runPipeline(userId: string, search: ProspectSearch, budget: AiCallBudget): Promise<RunPipelineResult> {
    // 1) Resolve the company. This runs before the cache check because the
    // canonical fingerprint is keyed on the RESOLVED company identity (so
    // "Apple"/"Apple Inc." share a cache entry) — not the raw typed name.
    await this.setStatus(search.id, "RESOLVING_COMPANY", { errorCode: null, errorMessage: null });
    const resolution = await this.companyResolution.resolve({
      companyName: search.requestedCompany,
      providedDomain: search.requestedDomain,
      providedLinkedinUrl: search.requestedLinkedin,
      budget,
      searchId: search.id
    });

    if (!resolution.officialWebsiteDomain && !resolution.linkedinCompanyUrl) {
      throw new ProspectError(
        "COMPANY_UNRESOLVED",
        "Could not resolve this company well enough to run a targeted profile search. Add a company website domain or LinkedIn company URL and try again."
      );
    }

    const company = await this.upsertCompany(userId, resolution);
    await this.prisma.prospectSearch.update({ where: { id: search.id }, data: { companyId: company.id } });

    // 2) Build the canonical fingerprint for the shared 30-day result cache.
    const { input: fingerprintInput, fingerprint } = computeDiscoverFingerprint({
      company: {
        linkedinCompanyUrl: resolution.linkedinCompanyUrl,
        officialWebsiteDomain: resolution.officialWebsiteDomain,
        officialDomain: resolution.officialDomain,
        normalizedName: resolution.normalizedName
      },
      roles: this.asStringArray(search.requestedTitles),
      locations: this.asStringArray(search.requestedLocations),
      resultLimit: resolveResultsPerSearch(),
      cacheVersion: resolveSharedCacheVersion()
    });

    // 3) Reuse a fresh shared dataset, or run Apify behind the stampede lock and
    // refresh the shared cache. The provider closure performs the real Apify +
    // classification + email inference and returns a normalized dataset.
    const startedAt = Date.now();
    let cacheResult;
    try {
      cacheResult = await this.discoverCache.getOrRefresh({
        fingerprint,
        fingerprintInput,
        company: {
          name: resolution.officialName,
          domain: resolution.officialWebsiteDomain ?? resolution.officialDomain,
          linkedinUrl: resolution.linkedinCompanyUrl
        },
        provider: () => this.runProviderDataset(userId, search, company, resolution, budget)
      });
    } catch (error) {
      logDiscoverCacheEvent({
        event: "DISCOVER_CACHE_REFRESH_FAILED",
        searchId: search.id,
        userId,
        fingerprint,
        cacheHit: false,
        cacheAgeDays: null,
        resultCount: 0,
        providerCalled: true,
        processingLatencyMs: Date.now() - startedAt
      });
      throw error;
    }

    // 4) Materialize the shared dataset into THIS user's own records. The shared
    // cache only holds normalized public data — the user-owned company/people/
    // search records (and their ownership, exports, suppression) stay private.
    const processed = await this.materializeDataset(userId, company, cacheResult.dataset);

    const cacheHit = cacheResult.source === "CACHE";
    logDiscoverCacheEvent({
      event: cacheHit
        ? "DISCOVER_CACHE_HIT"
        : cacheResult.refreshedStale
          ? "DISCOVER_CACHE_REFRESHED"
          : "DISCOVER_CACHE_MISS",
      searchId: search.id,
      userId,
      fingerprint,
      cacheHit,
      cacheAgeDays: discoverCacheAgeDays(cacheResult.fetchedAt, startedAt),
      resultCount: processed,
      providerCalled: !cacheHit,
      processingLatencyMs: Date.now() - startedAt
    });

    // 5) Done — record internal result provenance (never exposed via GraphQL).
    const updated = await this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: {
        status: "READY",
        totalProcessed: processed,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        resultSource: cacheResult.source,
        sharedCacheId: cacheResult.cacheId,
        cacheFingerprint: fingerprint,
        cacheFetchedAt: cacheResult.fetchedAt
      }
    });
    return { search: updated, providerCalled: !cacheHit, resultCount: processed, cacheHit };
  }

  /**
   * Run the real provider pipeline (Apify + classification + email inference) and
   * return a normalized, shareable dataset. This performs NO user-owned writes
   * other than progress/metadata on the user's own search row — the caller writes
   * the dataset to the shared cache and materializes the user's records.
   */
  private async runProviderDataset(
    userId: string,
    search: ProspectSearch,
    company: ProspectCompany,
    resolution: CompanyResolution,
    budget: AiCallBudget
  ): Promise<ResolvedDataset> {
    // Discover people via Apify. The result count is always the server-fixed
    // value (never search.maxResults).
    await this.setStatus(search.id, "SEARCHING_PEOPLE");
    const maxResults = resolveResultsPerSearch();
    const searchResult = await this.apify.searchProfiles({
      companyName: resolution.officialName,
      companyLinkedinUrl: resolution.linkedinCompanyUrl,
      jobTitles: this.asStringArray(search.requestedTitles),
      locations: this.asStringArray(search.requestedLocations),
      maxResults
    });

    await this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: {
        apifyRunId: searchResult.runId,
        apifyDatasetId: searchResult.datasetId,
        totalFound: searchResult.totalFound
      }
    });

    // Classify unique titles (the global title-classification cache is reused).
    await this.setStatus(search.id, "CLASSIFYING_POSITIONS");
    const rawTitles = searchResult.profiles
      .map((profile) => profile.currentTitle)
      .filter((title): title is string => Boolean(title));
    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId: search.id });

    // Infer ONE evidence-backed company email domain + pattern.
    await this.setStatus(search.id, "INFERRING_EMAIL_PATTERN");
    const inference = await this.emailDomain.infer({
      userId,
      companyId: company.id,
      companyName: resolution.officialName,
      officialWebsiteDomain: company.officialWebsiteDomain ?? company.officialDomain,
      knownLinkedinUrl: company.linkedinUrl,
      targetRoles: this.asStringArray(search.requestedTitles),
      budget,
      searchId: search.id
    });

    const emailFormat = {
      emailDomain: inference.selectedEmailDomain,
      emailDomainConfidence: inference.emailDomainConfidence,
      emailDomainEvidence: inference.emailDomainEvidence,
      emailPattern: inference.selectedPattern,
      patternConfidence: inference.patternConfidence,
      patternEvidence: inference.patternEvidence,
      emailFormatReason: serializeEmailFormatDecisionMetadata(inference.decision)
    };

    // Generate candidate emails deterministically and build the normalized
    // dataset shared across users.
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(emailFormat.emailDomainConfidence, emailFormat.patternConfidence);
    const people: ResolvedCachePerson[] = searchResult.profiles.map((profile) => {
      const category = this.categoryForProfile(profile, classifications);
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

    return { emailFormat, people };
  }

  /**
   * Copy a normalized dataset (from the shared cache or a fresh provider run)
   * into the requesting user's own company/position/people records. Shared by
   * both the cache-hit and provider paths so behavior is identical. No AI runs
   * here; categories and emails are already resolved in the dataset.
   */
  private async materializeDataset(
    userId: string,
    company: ProspectCompany,
    dataset: ResolvedDataset
  ): Promise<number> {
    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: company.id },
      data: {
        emailDomain: dataset.emailFormat.emailDomain,
        emailDomainConfidence: dataset.emailFormat.emailDomainConfidence,
        emailDomainEvidence: dataset.emailFormat.emailDomainEvidence as never,
        emailPattern: dataset.emailFormat.emailPattern,
        patternConfidence: dataset.emailFormat.patternConfidence,
        patternEvidence: dataset.emailFormat.patternEvidence as never,
        emailFormatReason: dataset.emailFormat.emailFormatReason,
        emailFormatDiscoveredAt: new Date()
      }
    });

    // One position node per category that has people.
    const rawTitlesByCategory = new Map<PositionCategory, Set<string>>();
    for (const person of dataset.people) {
      const category = coercePositionCategory(person.positionCategory);
      if (!rawTitlesByCategory.has(category)) {
        rawTitlesByCategory.set(category, new Set());
      }
      if (person.currentTitle) {
        rawTitlesByCategory.get(category)!.add(person.currentTitle);
      }
    }

    const positionMap = new Map<PositionCategory, string>();
    for (const [category, titles] of rawTitlesByCategory) {
      const position = await this.prisma.prospectCompanyPosition.upsert({
        where: { companyId_category: { companyId: updatedCompany.id, category } },
        create: {
          companyId: updatedCompany.id,
          category,
          displayName: displayNameForCategory(category),
          rawTitles: Array.from(titles)
        },
        update: { displayName: displayNameForCategory(category), rawTitles: Array.from(titles) }
      });
      positionMap.set(category, position.id);
    }

    let processed = 0;
    for (const person of dataset.people) {
      const category = coercePositionCategory(person.positionCategory);
      const positionId = positionMap.get(category) ?? positionMap.get("OTHER");
      if (!positionId) {
        continue;
      }
      const fields = {
        companyId: updatedCompany.id,
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
        inferredEmail: person.inferredEmail,
        emailStatus: person.emailStatus,
        emailConfidence: person.emailConfidence,
        emailPattern: person.emailPattern,
        emailSource: person.emailSource
      };
      await this.prisma.prospectPerson.upsert({
        where: { userId_sourceProfileId: { userId, sourceProfileId: person.sourceProfileId } },
        create: { userId, sourceProfileId: person.sourceProfileId, ...fields },
        update: fields
      });
      processed += 1;
    }

    return processed;
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async upsertCompany(userId: string, resolution: CompanyResolution): Promise<ProspectCompany> {
    return this.prisma.prospectCompany.upsert({
      where: { userId_normalizedName: { userId, normalizedName: resolution.normalizedName } },
      create: {
        userId,
        name: resolution.officialName,
        normalizedName: resolution.normalizedName,
        officialName: resolution.officialName,
        officialDomain: resolution.officialWebsiteDomain,
        officialWebsiteDomain: resolution.officialWebsiteDomain,
        officialWebsite: resolution.officialWebsite,
        linkedinUrl: resolution.linkedinCompanyUrl,
        domainConfidence: resolution.domainConfidence,
        emailDomainConfidence: "UNAVAILABLE",
        patternConfidence: "UNAVAILABLE"
      },
      update: {
        name: resolution.officialName,
        officialName: resolution.officialName,
        officialDomain: resolution.officialWebsiteDomain,
        officialWebsiteDomain: resolution.officialWebsiteDomain,
        officialWebsite: resolution.officialWebsite,
        linkedinUrl: resolution.linkedinCompanyUrl,
        domainConfidence: resolution.domainConfidence
      }
    });
  }

  private categoryForProfile(
    profile: NormalizedProfile,
    classifications: Map<string, { category: PositionCategory }>
  ): PositionCategory {
    const normalized = profile.normalizedTitle ?? (profile.currentTitle ? normalizeTitle(profile.currentTitle) : "");
    const classification = normalized ? classifications.get(normalized) : undefined;
    return classification ? coercePositionCategory(classification.category) : "OTHER";
  }

  /** Re-run classification for an existing company's people. */
  async reclassifyCompanyPositions(userId: string, companyId: string): Promise<ProspectCompany> {
    const company = await this.requireOwnedCompany(userId, companyId);
    const people = await this.prisma.prospectPerson.findMany({ where: { companyId, userId } });
    const budget = createAiBudget();

    const rawTitles = people
      .map((person) => person.currentTitle)
      .filter((title): title is string => Boolean(title));
    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId: null });

    const rawTitlesByCategory = new Map<PositionCategory, Set<string>>();
    for (const person of people) {
      const normalized = person.normalizedTitle ?? (person.currentTitle ? normalizeTitle(person.currentTitle) : "");
      const category = normalized ? coercePositionCategory(classifications.get(normalized)?.category) : "OTHER";
      if (!rawTitlesByCategory.has(category)) {
        rawTitlesByCategory.set(category, new Set());
      }
      if (person.currentTitle) {
        rawTitlesByCategory.get(category)!.add(person.currentTitle);
      }
    }

    const positionMap = new Map<PositionCategory, string>();
    for (const [category, titles] of rawTitlesByCategory) {
      const position = await this.prisma.prospectCompanyPosition.upsert({
        where: { companyId_category: { companyId, category } },
        create: { companyId, category, displayName: displayNameForCategory(category), rawTitles: Array.from(titles) },
        update: { displayName: displayNameForCategory(category), rawTitles: Array.from(titles) }
      });
      positionMap.set(category, position.id);
    }

    for (const person of people) {
      const normalized = person.normalizedTitle ?? (person.currentTitle ? normalizeTitle(person.currentTitle) : "");
      const category = normalized ? coercePositionCategory(classifications.get(normalized)?.category) : "OTHER";
      const positionId = positionMap.get(category);
      if (positionId && positionId !== person.positionId) {
        await this.prisma.prospectPerson.update({ where: { id: person.id }, data: { positionId } });
      }
    }

    return this.requireOwnedCompany(userId, companyId);
  }

  /** Re-run email-domain/pattern inference and regenerate every person's email. */
  async reinferCompanyEmailPattern(userId: string, companyId: string): Promise<ProspectCompany> {
    const company = await this.requireOwnedCompany(userId, companyId);
    return this.refreshCompanyEmailFormat(userId, companyId, null, company);
  }

  async refreshCompanyEmailFormat(
    userId: string,
    companyId: string,
    sourceUrl?: string | null,
    ownedCompany?: ProspectCompany
  ): Promise<ProspectCompany> {
    const company = ownedCompany ?? (await this.requireOwnedCompany(userId, companyId));
    const trimmedSourceUrl = sourceUrl?.trim() || null;
    if (!trimmedSourceUrl && !hasConfiguredEmailFormatDiscovery()) {
      throw new ProspectError(
        "NOT_CONFIGURED",
        "Email-format discovery is not configured. Enable AI web search (set OPENAI_API_KEY with PROSPECT_AI_ENABLED and PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED), paste a public email-format source URL, or set the format manually."
      );
    }
    return this.inferAndApplyEmailFormat(userId, company, { sourceUrl: trimmedSourceUrl });
  }

  /**
   * Discover a company's email format with AI web search (the "Find with AI"
   * path). High-confidence results are cached for 30 days to avoid paying for the
   * search again, and each user is rate limited. Pass `force` to refresh anyway.
   */
  async discoverCompanyEmailFormat(
    userId: string,
    companyId: string,
    options: { force?: boolean } = {}
  ): Promise<ProspectCompany> {
    const company = await this.requireOwnedCompany(userId, companyId);

    if (!isOpenAIEmailFormatDiscoveryConfigured()) {
      throw new ProspectError(
        "NOT_CONFIGURED",
        "AI email-format search is unavailable. It needs OPENAI_API_KEY with PROSPECT_AI_ENABLED and PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED. Paste a public source URL or set the format manually instead."
      );
    }

    // Cache: reuse a fresh HIGH-confidence format and only regenerate emails for
    // any new people, unless the user explicitly forced a refresh.
    if (!options.force && isFreshHighConfidenceFormat(company)) {
      const metadata = parseEmailFormatDecisionMetadata(company.emailFormatReason);
      console.info("[email-format-ai] Resolution completed.", {
        operation: "company_format_cache",
        model: env.PROSPECT_AI_MODEL ?? DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL,
        sourceCount: metadata?.supportingSourceCount ?? 0,
        cacheHit: true,
        aiUsed: false,
        decisionCode: metadata?.decisionCode ?? "SOURCE_MAJORITY"
      });
      await this.regenerateCompanyEmails(userId, company);
      return this.requireOwnedCompany(userId, companyId);
    }

    const refreshKey = `${userId}:${companyId}:email-format`;
    const existing = EMAIL_FORMAT_REFRESH_IN_FLIGHT.get(refreshKey);
    if (existing) {
      return existing;
    }

    const refresh = (async () => {
      const limit = await this.emailFormatRateLimiter(userId);
      if (!limit.allowed) {
        const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
        throw new ProspectError(
          "RATE_LIMITED",
          `You've reached the AI email-format search limit. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
        );
      }

      const reuseStoredEvidence = Boolean(options.force && hasFreshStoredEmailEvidence(company));
      return this.inferAndApplyEmailFormat(userId, company, {
        sourceUrl: null,
        reuseStoredEvidence
      });
    })();
    EMAIL_FORMAT_REFRESH_IN_FLIGHT.set(refreshKey, refresh);
    try {
      return await refresh;
    } finally {
      if (EMAIL_FORMAT_REFRESH_IN_FLIGHT.get(refreshKey) === refresh) {
        EMAIL_FORMAT_REFRESH_IN_FLIGHT.delete(refreshKey);
      }
    }
  }

  /**
   * Run email-domain/pattern inference for a company, persist the selected
   * format + evidence, and regenerate every person's candidate email. Shared by
   * the source-URL refresh and the AI discovery paths.
   */
  private async inferAndApplyEmailFormat(
    userId: string,
    company: ProspectCompany,
    opts: { sourceUrl?: string | null; reuseStoredEvidence?: boolean }
  ): Promise<ProspectCompany> {
    const budget = createAiBudget();

    const inference = await this.emailDomain.infer({
      userId,
      companyId: company.id,
      companyName: company.officialName ?? company.name,
      officialWebsiteDomain: company.officialWebsiteDomain ?? company.officialDomain,
      knownLinkedinUrl: company.linkedinUrl,
      sourceUrl: opts.sourceUrl ?? null,
      skipProvider: opts.reuseStoredEvidence,
      forceAiResolution: opts.reuseStoredEvidence,
      extraEvidence: opts.reuseStoredEvidence
        ? {
            domainEvidence: Array.isArray(company.emailDomainEvidence)
              ? (company.emailDomainEvidence as unknown as EmailDomainEvidence[])
              : [],
            patternEvidence: Array.isArray(company.patternEvidence)
              ? (company.patternEvidence as unknown as EmailPatternEvidence[])
              : []
          }
        : undefined,
      budget,
      searchId: null
    });

    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: company.id },
      data: {
        emailDomain: inference.selectedEmailDomain,
        emailDomainConfidence: inference.emailDomainConfidence,
        emailDomainEvidence: inference.emailDomainEvidence,
        emailPattern: inference.selectedPattern,
        patternConfidence: inference.patternConfidence,
        patternEvidence: inference.patternEvidence,
        emailFormatReason: serializeEmailFormatDecisionMetadata(inference.decision),
        emailFormatDiscoveredAt: new Date()
      }
    });

    await this.regenerateCompanyEmails(userId, updatedCompany);
    return this.requireOwnedCompany(userId, company.id);
  }

  async setCompanyEmailInferenceOverride(
    userId: string,
    input: {
      companyId: string;
      emailDomain: string;
      emailPattern: string;
      confidence: ConfidenceLevel;
      reason?: string | null;
    }
  ): Promise<ProspectCompany> {
    await this.requireOwnedCompany(userId, input.companyId);

    const emailDomain = normalizeDomain(input.emailDomain);
    if (!emailDomain || !isAllowedBusinessEmailDomain(emailDomain)) {
      throw new ProspectError("INVALID_STATE", "Enter a valid business email domain.");
    }
    if (!isEmailPattern(input.emailPattern)) {
      throw new ProspectError("INVALID_STATE", "Enter a supported email pattern.");
    }
    if (!isConfidenceLevel(input.confidence)) {
      throw new ProspectError("INVALID_STATE", "Enter a valid confidence level.");
    }

    const manualEvidence = makeManualEmailDomainEvidence({
      emailDomain,
      emailPattern: input.emailPattern,
      confidence: input.confidence,
      reason: input.reason
    });

    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: input.companyId },
      data: {
        emailDomain,
        emailDomainConfidence: input.confidence,
        emailDomainEvidence: [manualEvidence.domainEvidence],
        emailPattern: input.emailPattern,
        patternConfidence: input.confidence,
        patternEvidence: [manualEvidence.patternEvidence],
        emailFormatReason: input.reason?.trim() || "Manual override",
        emailFormatDiscoveredAt: new Date()
      }
    });

    await this.regenerateCompanyEmails(userId, updatedCompany);
    return this.requireOwnedCompany(userId, input.companyId);
  }

  private async regenerateCompanyEmails(userId: string, updatedCompany: ProspectCompany): Promise<void> {
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(updatedCompany.emailDomainConfidence, updatedCompany.patternConfidence);
    const people = await this.prisma.prospectPerson.findMany({ where: { companyId: updatedCompany.id, userId } });

    for (const person of people) {
      const candidate = resolveCandidateEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        domain: updatedCompany.emailDomain,
        pattern: updatedCompany.emailPattern,
        patternConfidence: candidateConfidence,
        allowLowConfidence
      });
      await this.prisma.prospectPerson.update({
        where: { id: person.id },
        data: {
          inferredEmail: candidate.email,
          emailStatus: candidate.status,
          emailConfidence: candidate.confidence,
          emailPattern: candidate.email ? updatedCompany.emailPattern : null,
          emailSource: candidate.email ? "PATTERN" : null
        }
      });
    }
  }
}

function discoverCacheAgeDays(fetchedAt: Date | null, nowMs: number): number | null {
  if (!fetchedAt) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - fetchedAt.getTime()) / (24 * 60 * 60 * 1000)));
}

type DiscoverCacheLogEvent = {
  event: "DISCOVER_CACHE_HIT" | "DISCOVER_CACHE_MISS" | "DISCOVER_CACHE_REFRESHED" | "DISCOVER_CACHE_REFRESH_FAILED";
  searchId: string;
  userId: string;
  fingerprint: string;
  cacheHit: boolean;
  cacheAgeDays: number | null;
  resultCount: number;
  providerCalled: boolean;
  processingLatencyMs: number;
};

/**
 * Structured, privacy-safe observability for the shared cache. Logs only safe
 * metadata (a fingerprint hash prefix, never full people lists, generated
 * emails, provider payloads, requester email, or prompts). Silent in tests.
 */
function logDiscoverCacheEvent(event: DiscoverCacheLogEvent): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  console.info(`[discover-cache] ${JSON.stringify({ ...event, fingerprint: event.fingerprint.slice(0, 16) })}`);
}

type DiscoverProcessingLogEvent = {
  searchId: string;
  userId: string;
  attemptId: string;
  attemptNumber: number;
  previousStatus: string;
  newStatus: "READY" | "FAILED";
  cacheHit: boolean;
  /** Whether the paid provider ran (null when the attempt failed before the cache stage). */
  providerCalled: boolean | null;
  providerResultCount: number;
  /** Safe public category (never a raw internal code) when the attempt failed. */
  errorCategory: string | null;
  retryable: boolean;
  durationMs: number;
};

/**
 * Structured, privacy-safe observability for one processing attempt. Proves
 * whether the provider was actually called on a retry and records the safe
 * failure category — never raw provider payloads, people lists, generated emails,
 * API keys, or the raw internal error text. Silent in tests.
 */
function logDiscoverProcessingEvent(event: DiscoverProcessingLogEvent): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  console.info(`[discover-process] ${JSON.stringify(event)}`);
}
