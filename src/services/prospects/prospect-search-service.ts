import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient, type ProspectCompany, type ProspectSearch } from "@prisma/client";

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
  processDatasetItems,
  type ApifyIngestionDiagnostics,
  type NormalizedProfile
} from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService, type CompanyResolution } from "@/services/prospects/company-resolution-service";
import { getCanonicalCompanyKey } from "@/services/prospects/canonical-company";
import {
  companyEmailFormatData,
  hasUsableCompanyEmailFormat,
  resolveCompanyEmailFormatUpdate,
  type CompanyEmailFormatAuthority,
  type CompanyEmailFormatRecord
} from "@/services/prospects/company-email-format";
import {
  DiscoverSearchCacheService,
  resolveEmailFormatDiscoveryExpiry,
  resolveSharedCacheVersion,
  type DiscoverCachePort,
  type DiscoverLocalPersonLookupResult,
  type ResolvedCachePerson,
  type ResolvedDataset
} from "@/services/prospects/discover-cache-service";
import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import {
  createDiscoverRoleIntelligenceService,
  type DiscoverRoleIntelligencePort
} from "@/services/prospects/discover-role-intelligence-service";
import {
  EmailDomainService,
  type EmailDomainEvidence,
  type EmailFormatDiscoveryResult,
  type EmailPatternEvidence,
  isAllowedBusinessEmailDomain,
  makeManualEmailDomainEvidence
} from "@/services/prospects/email-domain-service";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";
import {
  DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL,
  isOpenAIEmailFormatDiscoveryConfigured
} from "@/services/prospects/openai-email-format-discovery";
import {
  OpenAIPersonIdentityResolver,
  type PersonIdentityResolverPort,
  resolveIncompleteIdentities
} from "@/services/prospects/openai-person-identity-resolution";
import { AiCallBudget, createAiBudget } from "@/services/prospects/prospect-ai";
import {
  resolveCompanyRoleSearchAction,
  validateCompanyRoleSearchInput
} from "@/services/prospects/discover-company-role-search";
import { validateDiscoverSearchLabels } from "@/services/prospects/discover-search-label-validation";
import { normalizeDomain, normalizeTitle } from "@/services/prospects/prospect-normalization";
import { rateLimit } from "@/lib/rate-limit";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { ValidatedCreateProspectSearch } from "@/services/prospects/prospect-validation";

export type ProspectErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "COMPANY_UNRESOLVED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "DISCOVER_DAILY_LIMIT_REACHED"
  | "DISCOVER_EXPANSION_ALREADY_RUNNING"
  | "DISCOVER_EXPANSION_FAILED"
  | "DUPLICATE_ROLE_LOCATION";

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

function isFreshUsableCompanyFormat(company: ProspectCompany): boolean {
  if (!hasUsableCompanyEmailFormat(company)) {
    return false;
  }
  if (company.emailFormatAuthority === "MANUAL") {
    return true;
  }
  if (!company.emailFormatDiscoveredAt) {
    return false;
  }
  return Date.now() - company.emailFormatDiscoveredAt.getTime() < EMAIL_FORMAT_CACHE_TTL_MS;
}

function cachedEmailFormatStateIsFresh(format: ResolvedDataset["emailFormat"], now: Date): boolean {
  if (!format.emailFormatDiscoveryExpiresAt) {
    // Legacy valid cache rows are reusable; legacy empty rows are retried.
    return hasUsableCompanyEmailFormat(format);
  }
  return new Date(format.emailFormatDiscoveryExpiresAt).getTime() > now.getTime();
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
  /** Additive pgvector role layer; defaults to the feature-flagged production implementation. */
  roleIntelligence?: DiscoverRoleIntelligencePort;
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
  /**
   * Fallback resolver for people whose provider name is too incomplete to build
   * an address from. Defaults to the OpenAI web-search resolver, which is inert
   * unless PROSPECT_IDENTITY_RESOLUTION_ENABLED and an API key are configured.
   */
  identityResolver?: PersonIdentityResolverPort;
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
  private readonly roleIntelligence: DiscoverRoleIntelligencePort;
  private readonly emailDomain: EmailDomainService;
  private readonly pipelineTimeoutMs: number;
  private readonly emailFormatRateLimiter: EmailFormatRateLimiter;
  private readonly discoverQuota: DiscoverQuotaReserver;
  private readonly discoverCache: DiscoverCachePort;
  private readonly audit: ProspectAuditFn;
  private readonly identityResolver: PersonIdentityResolverPort;
  private readonly now: () => Date;

  constructor(deps: ProspectSearchServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.companyResolution = deps.companyResolution;
    this.roleClassifier = deps.roleClassifier;
    this.roleIntelligence =
      deps.roleIntelligence ?? createDiscoverRoleIntelligenceService(deps.prisma, deps.roleClassifier);
    this.emailDomain = deps.emailDomain;
    this.pipelineTimeoutMs = deps.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS;
    this.emailFormatRateLimiter = deps.emailFormatRateLimiter ?? defaultEmailFormatRateLimiter;
    this.discoverQuota = deps.discoverQuota ?? reserveDiscoverSearchSlot;
    this.discoverCache = deps.discoverCache ?? new DiscoverSearchCacheService({ prisma: deps.prisma });
    this.audit = deps.audit ?? noopAudit;
    this.identityResolver = deps.identityResolver ?? new OpenAIPersonIdentityResolver();
    this.now = deps.now ?? (() => new Date());
  }

  async createSearch(userId: string, input: ValidatedCreateProspectSearch): Promise<ProspectSearch> {
    const roles = validateDiscoverSearchLabels({ type: "ROLE", values: input.jobTitles });
    if (!roles.ok || roles.values.length === 0) {
      throw new ProspectError("INVALID_INPUT", roles.ok ? "Enter a job title to search." : roles.message);
    }
    const locations = validateDiscoverSearchLabels({ type: "LOCATION", values: input.locations });
    if (!locations.ok) {
      throw new ProspectError("INVALID_INPUT", locations.message);
    }
    return this.prisma.prospectSearch.create({
      data: {
        userId,
        requestedCompany: input.companyName,
        requestedDomain: input.companyDomain,
        requestedLinkedin: input.companyLinkedinUrl,
        requestedTitles: roles.values,
        requestedLocations: locations.values,
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
    if (search.status === "READY" || search.status === "NO_RESULTS") {
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
    let search = await this.requireOwnedSearch(userId, searchId);

    // Legacy/manual drafts may predate the validation boundary. Re-validate
    // before quota, cache identity, or provider work; safe corrections are
    // stamped canonically, while incomplete/ambiguous values fail closed.
    const requestedTitles = this.asStringArray(search.requestedTitles);
    const roles = validateDiscoverSearchLabels({ type: "ROLE", values: requestedTitles });
    if (!roles.ok || roles.values.length === 0) {
      throw new ProspectError("INVALID_INPUT", roles.ok ? "Enter a job title to search." : roles.message);
    }
    const requestedLocations = this.asStringArray(search.requestedLocations);
    const locations = validateDiscoverSearchLabels({ type: "LOCATION", values: requestedLocations });
    if (!locations.ok) {
      throw new ProspectError("INVALID_INPUT", locations.message);
    }
    if (
      JSON.stringify(roles.values) !== JSON.stringify(requestedTitles) ||
      JSON.stringify(locations.values) !== JSON.stringify(requestedLocations)
    ) {
      search = await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: { requestedTitles: roles.values, requestedLocations: locations.values }
      });
    }

    // A legacy zero-result search may predate the NO_RESULTS status and sit at
    // READY with nothing processed — "Search this company again" must be able
    // to re-run it (the shared cache never reuses a zero-people entry).
    const isLegacyZeroResultReady = search.status === "READY" && (search.totalProcessed ?? 0) === 0;
    if (search.status === "READY" && !isLegacyZeroResultReady) {
      return search;
    }
    // A FAILED or NO_RESULTS search is intentionally NOT terminal — retrying it
    // re-runs the whole pipeline against the SAME record (no duplicate Search
    // History row).
    if (TERMINAL_STATUSES.has(search.status) && !isLegacyZeroResultReady) {
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
      // A successful attempt ends READY (people found) or NO_RESULTS (the
      // provider succeeded but found nobody) — never assume READY here.
      const newStatus = outcome.search.status === "NO_RESULTS" ? "NO_RESULTS" : "READY";
      this.logProcessingEvent({
        searchId: search.id,
        userId,
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus,
        cacheHit: outcome.cacheHit,
        providerCalled: outcome.providerCalled,
        providerResultCount: outcome.resultCount,
        errorCategory: null,
        // A no-result search stays retryable — a later run may find people.
        retryable: newStatus === "NO_RESULTS",
        durationMs: this.now().getTime() - startedAtMs
      });
      await this.safeAudit(isRetry ? "discover.retry_completed" : "discover.search_completed", userId, options.actorEmail, search.id, {
        attemptId,
        attemptNumber,
        previousStatus,
        newStatus,
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
   * "Search this company": run a NEW role/location search for a company the
   * user already owns, straight from the company detail page.
   *
   * Order matters for billing: ownership → input validation → duplicate
   * resolution → only then create/process. A duplicate role+location is
   * rejected BEFORE any quota reservation or provider work, so a blocked
   * submit never consumes a daily slot or calls the provider. An identical
   * DRAFT sibling is reused (processed) instead of creating a second row,
   * which also makes a replayed request idempotent. The created search passes
   * the company's own name/domain/LinkedIn as resolution anchors so the
   * pipeline materializes into the SAME company — nothing is hardcoded.
   */
  async searchCompanyRole(
    userId: string,
    args: {
      companyId: string;
      jobTitle: string;
      location?: string | null;
      actorEmail?: string | null;
      idempotencyKey?: string | null;
    }
  ): Promise<ProspectSearch> {
    const company = await this.requireOwnedCompany(userId, args.companyId);

    const validated = validateCompanyRoleSearchInput({ jobTitle: args.jobTitle, location: args.location });
    if (!validated.ok) {
      throw new ProspectError("INVALID_INPUT", validated.message);
    }

    const existingSearches = await this.prisma.prospectSearch.findMany({
      where: { userId, companyId: company.id }
    });
    const action = resolveCompanyRoleSearchAction({
      jobTitle: validated.jobTitle,
      location: validated.location,
      existingSearches
    });
    if (action.kind === "duplicate") {
      throw new ProspectError("DUPLICATE_ROLE_LOCATION", action.message);
    }

    let target: ProspectSearch;
    if (action.kind === "reuse-draft") {
      target = existingSearches.find((search) => search.id === action.searchId)!;
    } else {
      const created = await this.createSearch(userId, {
        companyName: company.name,
        companyDomain: company.officialWebsiteDomain ?? company.officialDomain ?? null,
        companyLinkedinUrl: company.linkedinUrl ?? null,
        jobTitles: [validated.jobTitle],
        locations: validated.location ? [validated.location] : [],
        maxResults: resolveResultsPerSearch()
      });
      // Unlike a main-page draft, this search's company is already known — stamp
      // it now so the duplicate scan above finds the row even while it is still
      // a DRAFT (e.g. stranded by a spent quota) or mid-pipeline. Processing
      // re-resolves and re-stamps the same company from the anchors above.
      target = await this.prisma.prospectSearch.update({
        where: { id: created.id },
        data: { companyId: company.id }
      });
    }

    // processSearch owns quota (reserved idempotently on this search id) and
    // the audit/attempt bookkeeping — identical to the main Discover flow.
    return this.processSearch(userId, target.id, {
      actorEmail: args.actorEmail ?? null,
      idempotencyKey: args.idempotencyKey ?? null
    });
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
    // refresh the shared cache. The provider closure performs Apify + role
    // classification only; email-format discovery has a separate lifecycle.
    const startedAt = Date.now();
    let providerStarted = false;
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
        filterCompanyPoolPeople: async (people) => {
          const requestedTitles = this.asStringArray(search.requestedTitles);
          return this.roleIntelligence.filterAndRankPeople({
            people,
            requestedTitles,
            requestedLocations: this.asStringArray(search.requestedLocations),
            context: "CACHE",
            options: { budget, searchId: search.id }
          });
        },
        lookupLocalPeople: () =>
          this.findReusableLocalPeople({
            userId,
            search,
            company,
            budget
          }),
        provider: () => {
          providerStarted = true;
          return this.runProviderDataset(userId, search, company, resolution, budget);
        }
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
        providerCalled: providerStarted,
        processingLatencyMs: Date.now() - startedAt,
        cacheHitType: null,
        candidateEntryCount: 0,
        candidatePersonCount: 0,
        matchingPersonCount: 0
      });
      throw error;
    }

    const cacheHit = cacheResult.source === "CACHE";

    // 4) Zero-result guard. The provider run SUCCEEDED but found nobody (or
    // every returned item was filtered out during normalization — the
    // ingestion diagnostics above record exactly why). This is a neutral
    // outcome, never a failure, and there is nothing to generate emails for,
    // so the paid email-format stage (AI web search / public-evidence lookup)
    // and materialization are skipped entirely. Provider run metadata
    // (apifyRunId/apifyDatasetId/totalFound) was already persisted by
    // runProviderDataset. The search stays retryable: the shared cache never
    // reuses a zero-people entry, so re-processing re-runs the provider.
    if (cacheResult.dataset.people.length === 0) {
      logDiscoverZeroResultEvent(search.id, userId);
      const updated = await this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: {
          status: "NO_RESULTS",
          totalProcessed: 0,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          resultSource: cacheResult.source,
          sharedCacheId: cacheResult.cacheId,
          cacheFingerprint: fingerprint,
          cacheFetchedAt: cacheResult.fetchedAt
        }
      });
      logDiscoverCacheEvent({
        event: discoverCacheEventName(cacheResult),
        searchId: search.id,
        userId,
        fingerprint,
        cacheHit,
        cacheAgeDays: discoverCacheAgeDays(cacheResult.fetchedAt, startedAt),
        resultCount: 0,
        providerCalled: !cacheHit,
        processingLatencyMs: Date.now() - startedAt,
        cacheHitType: cacheResult.cacheHitType ?? (cacheHit ? "EXACT" : null),
        candidateEntryCount: cacheResult.lookupDiagnostics?.candidateEntryCount ?? 0,
        candidatePersonCount: cacheResult.lookupDiagnostics?.candidatePersonCount ?? 0,
        matchingPersonCount: cacheResult.lookupDiagnostics?.matchingPersonCount ?? 0
      });
      return { search: updated, providerCalled: !cacheHit, resultCount: 0, cacheHit };
    }

    // 5) Resolve email format independently from the people cache. A cache hit
    // may reuse public people while its format is missing, stale, or a prior
    // transient failure; in that case only format discovery is rerun (no Apify,
    // no extra Discover quota).
    const emailFormat = await this.resolveAutomaticEmailFormat({
      userId,
      search,
      company,
      resolution,
      cachedFormat: cacheResult.dataset.emailFormat,
      cacheId: cacheResult.cacheId,
      budget
    });
    const resolvedDataset: ResolvedDataset = { ...cacheResult.dataset, emailFormat };

    // 6) Materialize the shared dataset into THIS user's own records. The shared
    // cache only holds normalized public data — the user-owned company/people/
    // search records (and their ownership, exports, suppression) stay private.
    // Allocation is CAPPED: the shared pool may hold many more candidates (other
    // users' expansions accumulate there), but this search only ever receives
    // its own `maxResults` batch, recorded as ProspectSearchPerson grants.
    const processed = await this.materializeDataset(
      userId,
      search,
      company,
      resolvedDataset,
      cacheResult.source === "CACHE" ? "CACHE" : "PROVIDER"
    );
    const finalProcessed = Math.max(0, processed);
    const finalStatus = finalProcessed > 0 ? "READY" : "NO_RESULTS";

    logDiscoverCacheEvent({
      event: discoverCacheEventName(cacheResult),
      searchId: search.id,
      userId,
      fingerprint,
      cacheHit,
      cacheAgeDays: discoverCacheAgeDays(cacheResult.fetchedAt, startedAt),
      resultCount: finalProcessed,
      providerCalled: !cacheHit,
      processingLatencyMs: Date.now() - startedAt,
      cacheHitType: cacheResult.cacheHitType ?? (cacheHit ? "EXACT" : null),
      candidateEntryCount: cacheResult.lookupDiagnostics?.candidateEntryCount ?? 0,
      candidatePersonCount: cacheResult.lookupDiagnostics?.candidatePersonCount ?? 0,
      matchingPersonCount: cacheResult.lookupDiagnostics?.matchingPersonCount ?? 0
    });

    this.logEmailFormatStage({
      searchId: search.id,
      companyDomain: normalizeDomain(resolution.officialWebsiteDomain ?? resolution.officialDomain),
      format: emailFormat,
      people: resolvedDataset.people
    });

    // 7) Done — the final state is determined by people ACTUALLY granted to
    // this search, never by the raw provider/cache candidate count. This is the
    // last guard against a future materialization path rejecting every
    // candidate after the dataset-level zero-result check above.
    if (finalStatus === "NO_RESULTS") {
      logDiscoverZeroResultEvent(search.id, userId);
    }
    const updated = await this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: {
        status: finalStatus,
        totalProcessed: finalProcessed,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        resultSource: cacheResult.source,
        sharedCacheId: cacheResult.cacheId,
        cacheFingerprint: fingerprint,
        cacheFetchedAt: cacheResult.fetchedAt
      }
    });
    return { search: updated, providerCalled: !cacheHit, resultCount: finalProcessed, cacheHit };
  }

  /**
   * Reuse only this requester's already-materialized people for the strongly
   * resolved company. These private rows are converted to the common cache
   * candidate shape solely for the existing semantic authorization/ranking
   * path; they are never written into DiscoverSearchCache.
   */
  private async findReusableLocalPeople(input: {
    userId: string;
    search: ProspectSearch;
    company: ProspectCompany;
    budget: AiCallBudget;
  }): Promise<DiscoverLocalPersonLookupResult> {
    const rows = await this.prisma.prospectPerson.findMany({
      where: { userId: input.userId, companyId: input.company.id },
      include: { position: { select: { category: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const candidates: ResolvedCachePerson[] = rows.map((person) => ({
      sourceProfileId: person.sourceProfileId,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: person.fullName,
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
    const matching = await this.roleIntelligence.filterAndRankPeople({
      people: candidates,
      requestedTitles: this.asStringArray(input.search.requestedTitles),
      requestedLocations: this.asStringArray(input.search.requestedLocations),
      context: "CACHE",
      options: { budget: input.budget, searchId: input.search.id }
    });

    return {
      dataset:
        matching.length > 0
          ? { emailFormat: this.companyResolvedEmailFormat(input.company), people: matching }
          : null,
      candidatePersonCount: candidates.length,
      matchingPersonCount: matching.length
    };
  }

  /**
   * Run the people provider pipeline (Apify + role classification) and
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
    const requestedTitles = this.asStringArray(search.requestedTitles);
    const providerTitles = await this.roleIntelligence.buildProviderTitlePlan(requestedTitles, {
      budget,
      searchId: search.id
    });
    const searchResult = await this.apify.searchProfiles({
      companyName: resolution.officialName,
      companyLinkedinUrl: resolution.linkedinCompanyUrl,
      // One actor run receives the entire bounded semantic title plan.
      jobTitles: providerTitles,
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

    // Per-stage counters proving exactly where provider items were accepted or
    // rejected — a successful run can never silently lose its dataset again.
    logDiscoverIngestionEvent({
      searchId: search.id,
      userId,
      source: "PROVIDER",
      ...searchResult.diagnostics,
      eligiblePeople: searchResult.profiles.length
    });

    // Complete the identities deterministic parsing could not ("Jared C.").
    // Clean names never reach the model, and an unresolved person simply keeps
    // no email rather than receiving a guessed one.
    const profiles = await resolveIncompleteIdentities(searchResult.profiles, {
      companyName: resolution.officialName,
      companyDomain: company.emailDomain ?? resolution.officialWebsiteDomain ?? null,
      resolver: this.identityResolver,
      budget
    });

    // Classify unique titles (the global title-classification cache is reused).
    await this.setStatus(search.id, "CLASSIFYING_POSITIONS");
    const rawTitles = profiles
      .map((profile) => profile.currentTitle)
      .filter((title): title is string => Boolean(title));
    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId: search.id });

    // People retrieval/classification and email-format discovery have separate
    // cache lifecycles. Seed the provider dataset with only an already-valid
    // canonical format; runPipeline resolves/retries format discovery after the
    // people cache returns on BOTH provider and cache paths.
    const emailFormat = this.companyResolvedEmailFormat(company);

    // Build the normalized people dataset. Candidate emails are regenerated
    // against the final persisted format during materialization.
    const people = this.buildDatasetPeople(profiles, classifications, emailFormat);

    // With the feature off this method returns the exact current provider
    // behavior. With it on, expanded provider matches are authorized again by
    // category/specialty policy before they enter shared knowledge.
    const roleFilteredPeople = this.roleIntelligence.enabled
      ? await this.roleIntelligence.filterAndRankPeople({
          people,
          requestedTitles,
          requestedLocations: this.asStringArray(search.requestedLocations),
          context: "PROVIDER",
          options: { budget, searchId: search.id }
        })
      : people;

    return { emailFormat, people: roleFilteredPeople };
  }

  private companyResolvedEmailFormat(company: ProspectCompany): ResolvedDataset["emailFormat"] {
    return {
      emailDomain: company.emailDomain,
      emailDomainConfidence: company.emailDomainConfidence,
      emailDomainEvidence: company.emailDomainEvidence,
      emailPattern: company.emailPattern,
      patternConfidence: company.patternConfidence,
      patternEvidence: company.patternEvidence,
      emailFormatReason: company.emailFormatReason,
      emailFormatDiscoveryStatus: company.emailFormatDiscoveryStatus as
        | ResolvedDataset["emailFormat"]["emailFormatDiscoveryStatus"],
      emailFormatDiscoveryReason: company.emailFormatDiscoveryReason,
      emailFormatDiscoveryAt: company.emailFormatDiscoveryAt,
      emailFormatDiscoveryExpiresAt:
        company.emailFormatDiscoveryAt && company.emailFormatDiscoveryStatus !== "NOT_ATTEMPTED"
          ? resolveEmailFormatDiscoveryExpiry(
              company.emailFormatDiscoveryStatus as Exclude<
                ResolvedDataset["emailFormat"]["emailFormatDiscoveryStatus"],
                undefined
              >,
              company.emailFormatDiscoveryAt
            )
          : null
    };
  }

  /**
   * Layered company-format resolution, independent from people retrieval:
   * manual override -> fresh canonical format -> fresh cache state -> public/AI
   * discovery -> explicit unresolved/provider-failure state.
   */
  private async resolveAutomaticEmailFormat(input: {
    userId: string;
    search: ProspectSearch;
    company: ProspectCompany;
    resolution: CompanyResolution;
    cachedFormat: ResolvedDataset["emailFormat"];
    cacheId: string | null;
    budget: AiCallBudget;
  }): Promise<ResolvedDataset["emailFormat"]> {
    const { userId, search, company, resolution, cachedFormat, cacheId, budget } = input;
    await this.setStatus(search.id, "INFERRING_EMAIL_PATTERN");

    // Manual always wins, even if a shared cache contains a different format.
    if (company.emailFormatAuthority === "MANUAL" && hasUsableCompanyEmailFormat(company)) {
      return this.companyResolvedEmailFormat(company);
    }

    if (isFreshUsableCompanyFormat(company)) {
      return this.companyResolvedEmailFormat(company);
    }

    const now = this.now();
    if (cachedEmailFormatStateIsFresh(cachedFormat, now)) {
      const candidate: CompanyEmailFormatRecord = {
        ...cachedFormat,
        emailFormatDiscoveredAt:
          cachedFormat.emailFormatDiscoveryStatus === "FOUND"
            ? new Date(cachedFormat.emailFormatDiscoveryAt ?? now)
            : null,
        emailFormatDiscoveryStatus: cachedFormat.emailFormatDiscoveryStatus ?? "NOT_ATTEMPTED",
        emailFormatDiscoveryReason: cachedFormat.emailFormatDiscoveryReason ?? null,
        emailFormatDiscoveryAt: cachedFormat.emailFormatDiscoveryAt
          ? new Date(cachedFormat.emailFormatDiscoveryAt)
          : now
      };
      const updated = await this.applyCanonicalCompanyEmailFormat(
        userId,
        company.id,
        candidate,
        "SHARED_CACHE"
      );
      return {
        ...this.companyResolvedEmailFormat(updated),
        emailFormatDiscoveryExpiresAt: cachedFormat.emailFormatDiscoveryExpiresAt
      };
    }

    const inference = await this.emailDomain.infer({
      userId,
      companyId: company.id,
      companyName: resolution.officialName,
      officialWebsiteDomain: normalizeDomain(company.officialWebsiteDomain ?? company.officialDomain),
      knownLinkedinUrl: company.linkedinUrl,
      targetRoles: this.asStringArray(search.requestedTitles),
      budget,
      searchId: search.id
    });
    const format = this.inferenceResolvedEmailFormat(inference, now);
    const updated = await this.applyCanonicalCompanyEmailFormat(userId, company.id, {
      ...format,
      emailFormatDiscoveredAt: inference.status === "FOUND" ? now : null,
      emailFormatDiscoveryStatus: inference.status,
      emailFormatDiscoveryReason: inference.reason,
      emailFormatDiscoveryAt: now
    }, "AI");

    if (cacheId && this.discoverCache.updateEmailFormat) {
      await this.discoverCache.updateEmailFormat({ cacheId, format });
    }

    return {
      ...this.companyResolvedEmailFormat(updated),
      emailFormatDiscoveryStatus: inference.status,
      emailFormatDiscoveryReason: inference.reason,
      emailFormatDiscoveryAt: now,
      emailFormatDiscoveryExpiresAt: format.emailFormatDiscoveryExpiresAt,
      ...(inference.diagnostics ? { diagnostics: inference.diagnostics } : {})
    };
  }

  private inferenceResolvedEmailFormat(
    inference: EmailFormatDiscoveryResult,
    checkedAt: Date
  ): ResolvedDataset["emailFormat"] {
    return {
      emailDomain: inference.selectedEmailDomain,
      emailDomainConfidence: inference.emailDomainConfidence,
      emailDomainEvidence: inference.emailDomainEvidence,
      emailPattern: inference.selectedPattern,
      patternConfidence: inference.patternConfidence,
      patternEvidence: inference.patternEvidence,
      emailFormatReason: serializeEmailFormatDecisionMetadata(inference.decision),
      emailFormatDiscoveryStatus: inference.status,
      emailFormatDiscoveryReason: inference.reason,
      emailFormatDiscoveryAt: checkedAt,
      emailFormatDiscoveryExpiresAt: resolveEmailFormatDiscoveryExpiry(inference.status, checkedAt),
      ...(inference.diagnostics ? { diagnostics: inference.diagnostics } : {})
    };
  }

  /**
   * Deterministically map normalized profiles + role classifications + ONE
   * company-level email format into dataset people. No AI, no network — one
   * centralized generation path shared by the live provider run and
   * stored-dataset reprocessing.
   */
  private buildDatasetPeople(
    profiles: NormalizedProfile[],
    classifications: Map<string, { category: PositionCategory }>,
    emailFormat: ResolvedDataset["emailFormat"]
  ): ResolvedCachePerson[] {
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(emailFormat.emailDomainConfidence, emailFormat.patternConfidence);
    return profiles.map((profile) => {
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
  }

  /**
   * Rebuild a search's people from its ALREADY-STORED Apify dataset.
   *
   * This is the zero-result repair path for searches whose provider run
   * succeeded but whose ingestion lost the items (e.g. the pre-fix strict
   * company-slug rejection). Guarantees:
   *
   *  - reuses the stored dataset by dataset id — NEVER starts a new actor run;
   *  - never touches the daily Discover quota (no reservation is made);
   *  - never runs AI email-format discovery — people inherit the company's
   *    CURRENT canonical format (a manual override applies immediately);
   *  - idempotent: existing allocations are kept and only topped up to the
   *    search's own cap via the same (searchId, personId) grant upserts.
   */
  async reprocessSearchFromStoredDataset(userId: string, searchId: string): Promise<ProspectSearch> {
    const search = await this.requireOwnedSearch(userId, searchId);
    if (!search.apifyDatasetId) {
      throw new ProspectError("INVALID_STATE", "This search has no stored provider dataset to reprocess.");
    }
    if (!search.companyId) {
      throw new ProspectError("INVALID_STATE", "This search has no resolved company to reprocess against.");
    }
    const company = await this.requireOwnedCompany(userId, search.companyId);

    const items = await this.apify.fetchStoredDatasetItems(search.apifyDatasetId);
    if (items.length === 0) {
      throw new ProspectError("PROVIDER_ERROR", "The stored provider dataset is no longer available.");
    }

    const maxResults = search.maxResults > 0 ? search.maxResults : resolveResultsPerSearch();
    const processedItems = processDatasetItems(
      items,
      {
        companyName: company.officialName ?? company.name,
        linkedinCompanyUrl: company.linkedinUrl ?? search.requestedLinkedin
      },
      maxResults
    );

    logDiscoverIngestionEvent({
      searchId: search.id,
      userId,
      source: "REPROCESS",
      ...processedItems.diagnostics,
      eligiblePeople: processedItems.profiles.length
    });

    const budget = createAiBudget();
    const rawTitles = processedItems.profiles
      .map((profile) => profile.currentTitle)
      .filter((title): title is string => Boolean(title));
    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId: search.id });

    // The company's current canonical format is authoritative here; if it is
    // not usable yet, candidates stay UNAVAILABLE until the user resolves one.
    const emailFormat = {
      emailDomain: company.emailDomain,
      emailDomainConfidence: company.emailDomainConfidence,
      emailDomainEvidence: company.emailDomainEvidence,
      emailPattern: company.emailPattern,
      patternConfidence: company.patternConfidence,
      patternEvidence: company.patternEvidence,
      emailFormatReason: company.emailFormatReason
    };
    const people = this.buildDatasetPeople(processedItems.profiles, classifications, emailFormat);

    const processed = await this.materializeDataset(userId, search, company, { emailFormat, people }, "PROVIDER");

    return this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: {
        // A reprocess that still yields nobody is a neutral no-result outcome —
        // never a "Ready" search with zero people.
        status: processed > 0 ? "READY" : "NO_RESULTS",
        totalProcessed: processed,
        totalFound: items.length,
        completedAt: this.now(),
        errorCode: null,
        errorMessage: null
      }
    });
  }

  /**
   * Copy a normalized dataset (from the shared cache or a fresh provider run)
   * into the requesting user's own company/position/people records. Shared by
   * both the cache-hit and provider paths so behavior is identical. No AI runs
   * here; categories and emails are already resolved in the dataset.
   *
   * The user only ever receives their own allocation: at most `maxResults`
   * people in stable provider order, each recorded as a ProspectSearchPerson
   * grant. The shared pool may hold far more candidates (other users' "Add 10
   * more" expansions accumulate there) — those are never materialized here, so
   * the backend cannot return unallocated global candidates. Re-running the
   * same search (a retry) keeps its existing grants and only tops up to the
   * cap, so retries never inflate an allocation.
   */
  private async materializeDataset(
    userId: string,
    search: ProspectSearch,
    company: ProspectCompany,
    dataset: ResolvedDataset,
    allocationSource: "CACHE" | "PROVIDER"
  ): Promise<number> {
    const updatedCompany = await this.applyCanonicalCompanyEmailFormat(
      userId,
      company.id,
      {
        ...dataset.emailFormat,
        emailFormatDiscoveredAt:
          dataset.emailFormat.emailFormatDiscoveryStatus === "FOUND"
            ? new Date(dataset.emailFormat.emailFormatDiscoveryAt ?? this.now())
            : null,
        emailFormatDiscoveryStatus: dataset.emailFormat.emailFormatDiscoveryStatus ?? "NOT_ATTEMPTED",
        emailFormatDiscoveryReason: dataset.emailFormat.emailFormatDiscoveryReason ?? null,
        emailFormatDiscoveryAt: dataset.emailFormat.emailFormatDiscoveryAt
          ? new Date(dataset.emailFormat.emailFormatDiscoveryAt)
          : null
      },
      "SHARED_CACHE"
    );

    // Existing grants for THIS search (a retry after a partial failure keeps
    // them) — they count against the cap and are never allocated twice.
    const existingAllocations = await this.prisma.prospectSearchPerson.findMany({
      where: { searchId: search.id }
    });
    const allocatedPersonIds = existingAllocations.map((row) => row.personId);
    const allocatedPeople =
      allocatedPersonIds.length > 0
        ? await this.prisma.prospectPerson.findMany({ where: { id: { in: allocatedPersonIds } } })
        : [];
    const allocatedProfileIds = new Set(allocatedPeople.map((person) => person.sourceProfileId));

    const limit = search.maxResults > 0 ? search.maxResults : resolveResultsPerSearch();
    const capacity = Math.max(0, limit - existingAllocations.length);
    const selected = dataset.people
      .filter((person) => !allocatedProfileIds.has(person.sourceProfileId))
      .slice(0, capacity);

    const existingPeople = selected.length
      ? await this.prisma.prospectPerson.findMany({
          where: { userId, sourceProfileId: { in: selected.map((person) => person.sourceProfileId) } }
        })
      : [];
    const existingByProfileId = new Map(existingPeople.map((person) => [person.sourceProfileId, person]));

    // One position node per category that has allocated people.
    const rawTitlesByCategory = new Map<PositionCategory, Set<string>>();
    for (const person of selected) {
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

    let processed = existingAllocations.length;
    let allocationOrder = existingAllocations.length;
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    for (const person of selected) {
      const category = coercePositionCategory(person.positionCategory);
      const positionId = positionMap.get(category) ?? positionMap.get("OTHER");
      if (!positionId) {
        continue;
      }
      const existingPerson = existingByProfileId.get(person.sourceProfileId);
      const currentEmail = existingPerson ?? person;
      const emailFields = resolveProspectPersonEmail(currentEmail, updatedCompany, {
        allowLowConfidence,
        regenerateExistingInferred: true
      });
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
        ...emailFields
      };
      const materialized = await this.prisma.prospectPerson.upsert({
        where: { userId_sourceProfileId: { userId, sourceProfileId: person.sourceProfileId } },
        create: { userId, sourceProfileId: person.sourceProfileId, ...fields },
        update: fields
      });
      // The grant itself. The (searchId, personId) unique key makes a concurrent
      // duplicate write converge instead of double-allocating.
      await this.prisma.prospectSearchPerson.upsert({
        where: { searchId_personId: { searchId: search.id, personId: materialized.id } },
        create: {
          searchId: search.id,
          personId: materialized.id,
          userId,
          allocationOrder,
          allocationSource
        },
        update: {}
      });
      allocationOrder += 1;
      processed += 1;
    }

    return processed;
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async upsertCompany(userId: string, resolution: CompanyResolution): Promise<ProspectCompany> {
    const canonicalKey = getCanonicalCompanyKey({
      officialWebsiteDomain: resolution.officialWebsiteDomain,
      officialDomain: resolution.officialDomain,
      normalizedName: resolution.normalizedName
    });
    const update = {
      canonicalKey,
      name: resolution.officialName,
      officialName: resolution.officialName,
      officialDomain: resolution.officialWebsiteDomain,
      officialWebsiteDomain: resolution.officialWebsiteDomain,
      officialWebsite: resolution.officialWebsite,
      linkedinUrl: resolution.linkedinCompanyUrl,
      domainConfidence: resolution.domainConfidence
    };

    const canonicalMatch = await this.prisma.prospectCompany.findFirst({ where: { userId, canonicalKey } });
    if (canonicalMatch) {
      return this.prisma.prospectCompany.update({ where: { id: canonicalMatch.id }, data: update });
    }

    // Promote a previously unresolved name-only company when a later search
    // resolves its domain. Never reuse a same-name row that already owns a
    // different domain key.
    const unresolvedNameMatch = await this.prisma.prospectCompany.findFirst({
      where: { userId, normalizedName: resolution.normalizedName }
    });
    if (unresolvedNameMatch && getCanonicalCompanyKey(unresolvedNameMatch).startsWith("name:")) {
      return this.prisma.prospectCompany.update({ where: { id: unresolvedNameMatch.id }, data: update });
    }

    return this.prisma.prospectCompany.upsert({
      where: { userId_canonicalKey: { userId, canonicalKey } },
      create: {
        userId,
        canonicalKey,
        name: resolution.officialName,
        normalizedName: resolution.normalizedName,
        officialName: resolution.officialName,
        officialDomain: resolution.officialWebsiteDomain,
        officialWebsiteDomain: resolution.officialWebsiteDomain,
        officialWebsite: resolution.officialWebsite,
        linkedinUrl: resolution.linkedinCompanyUrl,
        domainConfidence: resolution.domainConfidence,
        emailDomainConfidence: "UNAVAILABLE",
        patternConfidence: "UNAVAILABLE",
        emailFormatAuthority: "UNRESOLVED"
      },
      update
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

    const candidate: CompanyEmailFormatRecord = {
      emailDomain: inference.selectedEmailDomain,
      emailDomainConfidence: inference.emailDomainConfidence,
      emailDomainEvidence: inference.emailDomainEvidence,
      emailPattern: inference.selectedPattern,
      patternConfidence: inference.patternConfidence,
      patternEvidence: inference.patternEvidence,
      emailFormatReason: serializeEmailFormatDecisionMetadata(inference.decision),
      emailFormatDiscoveredAt: inference.status === "FOUND" ? this.now() : null,
      emailFormatDiscoveryStatus: inference.status,
      emailFormatDiscoveryReason: inference.reason,
      emailFormatDiscoveryAt: this.now()
    };
    const candidateUsable = hasUsableCompanyEmailFormat(candidate);
    const updated = await this.applyCanonicalCompanyEmailFormat(
      userId,
      company.id,
      candidate,
      opts.sourceUrl ? "SOURCE" : "AI"
    );
    // Privacy-safe outcome: whether THIS action produced a usable format, and
    // whether the persisted company now has one (a prior valid format is
    // preserved even when a re-check finds nothing). Counts/booleans only.
    logDiscoverEmailFormatEvent({
      companyId: company.id,
      userId,
      action: opts.sourceUrl ? "SOURCE_URL" : "AI",
      providerConfigured: opts.sourceUrl ? true : hasConfiguredEmailFormatDiscovery(),
      resultStatus: candidateUsable ? "UPDATED" : inference.status,
      domainFound: Boolean(inference.selectedEmailDomain),
      patternFound: Boolean(inference.selectedPattern),
      companyHasUsableFormat: hasUsableCompanyEmailFormat(updated)
    });
    return updated;
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

    const updated = await this.applyCanonicalCompanyEmailFormat(
      userId,
      input.companyId,
      {
        emailDomain,
        emailDomainConfidence: input.confidence,
        emailDomainEvidence: [manualEvidence.domainEvidence],
        emailPattern: input.emailPattern,
        patternConfidence: input.confidence,
        patternEvidence: [manualEvidence.patternEvidence],
        emailFormatReason: input.reason?.trim() || "Manual override",
        emailFormatDiscoveredAt: this.now(),
        emailFormatDiscoveryStatus: "FOUND",
        emailFormatDiscoveryReason: null,
        emailFormatDiscoveryAt: this.now()
      },
      "MANUAL"
    );
    logDiscoverEmailFormatEvent({
      companyId: input.companyId,
      userId,
      action: "MANUAL",
      providerConfigured: true,
      resultStatus: "UPDATED",
      domainFound: true,
      patternFound: true,
      companyHasUsableFormat: hasUsableCompanyEmailFormat(updated)
    });
    return updated;
  }

  /**
   * Merge one format candidate against the strongest existing format for this
   * user's canonical company family, propagate the winner to legacy duplicate
   * rows, and repair eligible person candidates atomically. Serializable
   * isolation prevents two role searches from committing conflicting formats.
   */
  private async applyCanonicalCompanyEmailFormat(
    userId: string,
    companyId: string,
    candidate: CompanyEmailFormatRecord,
    authority: CompanyEmailFormatAuthority
  ): Promise<ProspectCompany> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const target = await tx.prospectCompany.findFirst({ where: { id: companyId, userId } });
            if (!target) {
              throw new ProspectError("NOT_FOUND", "Company not found.");
            }

            const canonicalKey = getCanonicalCompanyKey(target);
            const ownedCompanies = await tx.prospectCompany.findMany({ where: { userId } });
            const family = ownedCompanies.filter((row) => getCanonicalCompanyKey(row) === canonicalKey);

            let strongest: CompanyEmailFormatRecord = family[0] ?? target;
            for (const row of family.slice(1)) {
              strongest = resolveCompanyEmailFormatUpdate(strongest, row);
            }
            const resolved = resolveCompanyEmailFormatUpdate(
              strongest,
              { ...candidate, emailFormatAuthority: authority },
              authority
            );
            // Freshness invariant: a failed/empty discovery must NEVER look like a
            // completed "last checked" result. Only a genuinely USABLE resolved
            // format may advance `emailFormatDiscoveredAt`; otherwise the company's
            // prior marker is preserved (null for a never-resolved company). This
            // is the single choke point for all three write paths — initial search
            // materialization, Find with AI, and Use source URL — so an empty
            // provider/AI/source result can no longer poison the company with a
            // bogus fresh timestamp, block a later retry, or make people look
            // "checked" while they remain Unavailable.
            const resolvedForWrite: CompanyEmailFormatRecord = hasUsableCompanyEmailFormat(resolved)
              ? resolved
              : { ...resolved, emailFormatDiscoveredAt: target.emailFormatDiscoveredAt ?? null };
            const data = companyEmailFormatData(resolvedForWrite) as Prisma.ProspectCompanyUpdateInput;

            let updatedTarget: ProspectCompany | null = null;
            for (const row of family) {
              const updated = await tx.prospectCompany.update({ where: { id: row.id }, data });
              await this.regenerateCompanyEmails(userId, updated, tx);
              if (updated.id === companyId) {
                updatedTarget = updated;
              }
            }
            return updatedTarget ?? target;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (
          attempt < 2 &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2034"
        ) {
          continue;
        }
        throw error;
      }
    }

    // The loop either returns or throws; this is only for exhaustive typing.
    throw new ProspectError("INVALID_STATE", "Could not update the company email format.");
  }

  private async regenerateCompanyEmails(
    userId: string,
    updatedCompany: ProspectCompany,
    db: Pick<Prisma.TransactionClient, "prospectPerson"> = this.prisma
  ): Promise<void> {
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const people = await db.prospectPerson.findMany({ where: { companyId: updatedCompany.id, userId } });

    // Every generated address moves to the new format, including one whose
    // previous address had bounced: that failure belongs to the old address and
    // stays recorded against it, not against the person.
    for (const person of people) {
      const emailFields = resolveProspectPersonEmail(person, updatedCompany, {
        allowLowConfidence,
        regenerateExistingInferred: true
      });
      await db.prospectPerson.update({
        where: { id: person.id },
        data: emailFields
      });
    }
  }

  private logEmailFormatStage(input: {
    searchId: string;
    companyDomain: string | null;
    format: ResolvedDataset["emailFormat"];
    people: ResolvedCachePerson[];
  }): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    const confidence = combinedEmailConfidence(
      input.format.emailDomainConfidence,
      input.format.patternConfidence
    );
    const eligible = input.people.filter((person) => Boolean(person.firstName.trim() && person.lastName.trim()));
    const generatedEmailCount = eligible.filter((person) =>
      resolveCandidateEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        domain: input.format.emailDomain,
        pattern: input.format.emailPattern,
        patternConfidence: confidence,
        allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS
      }).email
    ).length;
    const diagnostics = input.format.diagnostics;
    console.info(
      `[discover-email-format-stage] ${JSON.stringify({
        searchId: input.searchId,
        companyDomain: input.companyDomain,
        providerConfigured: diagnostics?.providerConfigured ?? hasConfiguredEmailFormatDiscovery(),
        requestedTool: diagnostics?.requestedTool ?? null,
        webSearchToolInvoked: diagnostics?.webSearchOccurred ?? false,
        providerResponseReceived: Boolean(diagnostics?.responseStatus),
        responseStatus: diagnostics?.responseStatus ?? null,
        responseOutputItemTypes: diagnostics?.outputItemTypes ?? [],
        responseParsed: diagnostics?.structuredParsingSucceeded ?? false,
        discoveryStatus: input.format.emailFormatDiscoveryStatus ?? "NOT_ATTEMPTED",
        formatPersisted: hasUsableCompanyEmailFormat(input.format),
        eligiblePeopleCount: eligible.length,
        generatedEmailCount,
        unavailableCount: Math.max(0, eligible.length - generatedEmailCount)
      })}`
    );
  }
}

function discoverCacheAgeDays(fetchedAt: Date | null, nowMs: number): number | null {
  if (!fetchedAt) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - fetchedAt.getTime()) / (24 * 60 * 60 * 1000)));
}

type DiscoverCacheLogEvent = {
  event:
    | "DISCOVER_CACHE_HIT"
    | "DISCOVER_COMPANY_POOL_CACHE_HIT"
    | "DISCOVER_LOCAL_PERSON_REUSE"
    | "DISCOVER_CACHE_POOL_ZERO_MATCH"
    | "DISCOVER_CACHE_MISS"
    | "DISCOVER_CACHE_REFRESHED"
    | "DISCOVER_CACHE_REFRESH_FAILED";
  searchId: string;
  userId: string;
  fingerprint: string;
  cacheHit: boolean;
  cacheAgeDays: number | null;
  resultCount: number;
  providerCalled: boolean;
  processingLatencyMs: number;
  cacheHitType: "EXACT" | "COMPANY_POOL" | "LOCAL_PERSON" | null;
  candidateEntryCount: number;
  candidatePersonCount: number;
  matchingPersonCount: number;
};

function discoverCacheEventName(result: {
  source: "CACHE" | "PROVIDER";
  refreshedStale: boolean;
  cacheHitType?: "EXACT" | "COMPANY_POOL" | "LOCAL_PERSON" | null;
  lookupDiagnostics?: { candidateEntryCount: number; matchingPersonCount: number };
}): DiscoverCacheLogEvent["event"] {
  if (result.source === "CACHE") {
    if (result.cacheHitType === "LOCAL_PERSON") {
      return "DISCOVER_LOCAL_PERSON_REUSE";
    }
    return result.cacheHitType === "COMPANY_POOL" ? "DISCOVER_COMPANY_POOL_CACHE_HIT" : "DISCOVER_CACHE_HIT";
  }
  if (result.refreshedStale) {
    return "DISCOVER_CACHE_REFRESHED";
  }
  if ((result.lookupDiagnostics?.candidateEntryCount ?? 0) > 0 && result.lookupDiagnostics?.matchingPersonCount === 0) {
    return "DISCOVER_CACHE_POOL_ZERO_MATCH";
  }
  return "DISCOVER_CACHE_MISS";
}

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
  newStatus: "READY" | "NO_RESULTS" | "FAILED";
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

/**
 * Explicit cost-control marker: the pipeline stopped before the email-format
 * stage because there is nobody to generate emails for. No AI/web-search
 * tokens are ever spent on a zero-result search. Silent in tests.
 */
function logDiscoverZeroResultEvent(searchId: string, userId: string): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  console.info(
    `[discover] provider returned 0 people; skipping email format inference ${JSON.stringify({ searchId, userId })}`
  );
}

type DiscoverIngestionLogEvent = ApifyIngestionDiagnostics & {
  searchId: string;
  userId: string;
  /** Live provider run vs stored-dataset reprocessing. */
  source: "PROVIDER" | "REPROCESS";
  eligiblePeople: number;
};

/**
 * Structured, privacy-safe per-stage ingestion counters for one provider
 * dataset (counts only — never names, emails, LinkedIn URLs, raw items, or
 * tokens). When the provider returned items but every one was rejected, the
 * event is logged as a warning so a "Ready · 0 people" outcome is always
 * diagnosable. Silent in tests.
 */
function logDiscoverIngestionEvent(event: DiscoverIngestionLogEvent): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const line = `[discover-ingestion] Processed provider dataset. ${JSON.stringify(event)}`;
  if (event.itemsReturned > 0 && event.eligiblePeople === 0) {
    console.warn(line);
  } else {
    console.info(line);
  }
}

type DiscoverEmailFormatLogEvent = {
  companyId: string;
  userId: string;
  action: "AI" | "SOURCE_URL" | "MANUAL";
  /** Whether the required discovery provider is configured (never the key). */
  providerConfigured: boolean;
  resultStatus: "UPDATED" | EmailFormatDiscoveryResult["status"];
  domainFound: boolean;
  patternFound: boolean;
  /** Whether the persisted company has a usable format after the action. */
  companyHasUsableFormat: boolean;
  regeneratedPeople?: number;
};

/**
 * Structured, privacy-safe observability for one email-format correction. Logs
 * only safe booleans/counts — never raw emails, person names, model output,
 * source-page contents, API keys, or full source URLs. A NO_EVIDENCE outcome
 * is logged as a warning so a "found nothing" result is diagnosable and can
 * never be mistaken for a successful format update. Silent in tests.
 */
function logDiscoverEmailFormatEvent(event: DiscoverEmailFormatLogEvent): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const line = `[discover-email-format] ${JSON.stringify(event)}`;
  if (event.resultStatus !== "UPDATED" && !event.companyHasUsableFormat) {
    console.warn(line);
  } else {
    console.info(line);
  }
}
