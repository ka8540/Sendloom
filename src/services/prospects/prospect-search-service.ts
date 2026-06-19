import type { PrismaClient, ProspectCompany, ProspectSearch } from "@prisma/client";

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
  EmailDomainService,
  isAllowedBusinessEmailDomain,
  makeManualEmailDomainEvidence
} from "@/services/prospects/email-domain-service";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { isOpenAIEmailFormatDiscoveryConfigured } from "@/services/prospects/openai-email-format-discovery";
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
  | "DISCOVER_DAILY_LIMIT_REACHED";

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
// Cache window: skip a fresh AI web search when a HIGH-confidence format was
// discovered within the last 7 days (unless the user forces a refresh).
const EMAIL_FORMAT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  return Date.now() - new Date(discoveredAt).getTime() < EMAIL_FORMAT_CACHE_TTL_MS;
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
};

/** Options for processSearch — the actor email is resolved from the session. */
export type ProcessSearchOptions = {
  /** Authenticated account email (session-resolved) for the quota exemption. */
  actorEmail?: string | null;
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

  constructor(deps: ProspectSearchServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.companyResolution = deps.companyResolution;
    this.roleClassifier = deps.roleClassifier;
    this.emailDomain = deps.emailDomain;
    this.pipelineTimeoutMs = deps.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS;
    this.emailFormatRateLimiter = deps.emailFormatRateLimiter ?? defaultEmailFormatRateLimiter;
    this.discoverQuota = deps.discoverQuota ?? reserveDiscoverSearchSlot;
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
    if (TERMINAL_STATUSES.has(search.status)) {
      throw new ProspectError("INVALID_STATE", `A ${search.status} search cannot be processed.`);
    }

    const reservation = await this.discoverQuota({
      userId,
      email: options.actorEmail ?? null,
      searchId: search.id
    });
    if (!reservation.allowed) {
      throw new ProspectError("DISCOVER_DAILY_LIMIT_REACHED", formatDiscoverLimitMessage(reservation.status));
    }

    const budget = createAiBudget();

    try {
      return await withTimeout(
        this.runPipeline(userId, search, budget),
        this.pipelineTimeoutMs,
        () => new ProspectError("PROVIDER_TIMEOUT", "The profile search timed out. Try again in a moment.")
      );
    } catch (error) {
      const code = error instanceof ProspectError ? error.code : "PROVIDER_ERROR";
      const message = error instanceof Error ? error.message : "Prospect search failed.";
      return this.prisma.prospectSearch.update({
        where: { id: search.id },
        data: {
          status: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 500),
          completedAt: new Date()
        }
      });
    }
  }

  private async setStatus(searchId: string, status: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.prisma.prospectSearch.update({ where: { id: searchId }, data: { status, ...data } });
  }

  private async runPipeline(userId: string, search: ProspectSearch, budget: AiCallBudget): Promise<ProspectSearch> {
    // 1) Resolve the company.
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

    // 2) Discover people via Apify. The result count is always the server-fixed
    // value (never search.maxResults), so re-processing an old record — even one
    // persisted with a larger historical maxResults — runs a 10-person search.
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

    // 3) Classify unique titles and build position nodes.
    await this.setStatus(search.id, "CLASSIFYING_POSITIONS");
    const { positionMap, classifications } = await this.classifyAndUpsertPositions(
      company.id,
      searchResult.profiles,
      budget,
      search.id
    );

    // 4) Infer ONE company email domain + pattern from evidence.
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

    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: company.id },
      data: {
        emailDomain: inference.selectedEmailDomain,
        emailDomainConfidence: inference.emailDomainConfidence,
        emailDomainEvidence: inference.emailDomainEvidence,
        emailPattern: inference.selectedPattern,
        patternConfidence: inference.patternConfidence,
        patternEvidence: inference.patternEvidence,
        emailFormatReason: inference.reasonSummary ?? null,
        emailFormatDiscoveredAt: new Date()
      }
    });

    // 5) Generate candidate emails deterministically + persist people.
    const processed = await this.upsertPeople(userId, updatedCompany, searchResult.profiles, positionMap, classifications);

    // 6) Done.
    return this.prisma.prospectSearch.update({
      where: { id: search.id },
      data: {
        status: "READY",
        totalProcessed: processed,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });
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

  /**
   * Classify the profiles' unique titles, upsert one position node per category
   * that has people, and return a map of category -> positionId.
   */
  private async classifyAndUpsertPositions(
    companyId: string,
    profiles: NormalizedProfile[],
    budget: AiCallBudget,
    searchId: string
  ): Promise<{ positionMap: Map<PositionCategory, string>; classifications: Map<string, { category: PositionCategory }> }> {
    const rawTitles = profiles
      .map((profile) => profile.currentTitle)
      .filter((title): title is string => Boolean(title));

    const classifications = await this.roleClassifier.classify(rawTitles, { budget, searchId });

    // Group the original titles by their resolved category.
    const rawTitlesByCategory = new Map<PositionCategory, Set<string>>();
    for (const profile of profiles) {
      const category = this.categoryForProfile(profile, classifications);
      if (!rawTitlesByCategory.has(category)) {
        rawTitlesByCategory.set(category, new Set());
      }
      if (profile.currentTitle) {
        rawTitlesByCategory.get(category)!.add(profile.currentTitle);
      }
    }

    const positionMap = new Map<PositionCategory, string>();
    for (const [category, titles] of rawTitlesByCategory) {
      const position = await this.prisma.prospectCompanyPosition.upsert({
        where: { companyId_category: { companyId, category } },
        create: {
          companyId,
          category,
          displayName: displayNameForCategory(category),
          rawTitles: Array.from(titles)
        },
        update: {
          displayName: displayNameForCategory(category),
          rawTitles: Array.from(titles)
        }
      });
      positionMap.set(category, position.id);
    }

    return { positionMap, classifications };
  }

  private categoryForProfile(
    profile: NormalizedProfile,
    classifications: Map<string, { category: PositionCategory }>
  ): PositionCategory {
    const normalized = profile.normalizedTitle ?? (profile.currentTitle ? normalizeTitle(profile.currentTitle) : "");
    const classification = normalized ? classifications.get(normalized) : undefined;
    return classification ? coercePositionCategory(classification.category) : "OTHER";
  }

  private async upsertPeople(
    userId: string,
    company: ProspectCompany,
    profiles: NormalizedProfile[],
    positionMap: Map<PositionCategory, string>,
    classifications: Map<string, { category: PositionCategory }>
  ): Promise<number> {
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(company.emailDomainConfidence, company.patternConfidence);
    let processed = 0;

    for (const profile of profiles) {
      const category = this.categoryForProfile(profile, classifications);
      const positionId = positionMap.get(category) ?? positionMap.get("OTHER");
      if (!positionId) {
        continue;
      }

      const candidate = resolveCandidateEmail({
        firstName: profile.firstName,
        lastName: profile.lastName,
        domain: company.emailDomain,
        pattern: company.emailPattern,
        patternConfidence: candidateConfidence,
        allowLowConfidence
      });

      await this.prisma.prospectPerson.upsert({
        where: { userId_sourceProfileId: { userId, sourceProfileId: profile.sourceProfileId } },
        create: {
          userId,
          companyId: company.id,
          positionId,
          sourceProfileId: profile.sourceProfileId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          fullName: profile.fullName,
          currentTitle: profile.currentTitle,
          normalizedTitle: profile.normalizedTitle,
          location: profile.location,
          country: profile.country,
          state: profile.state,
          city: profile.city,
          linkedinUrl: profile.linkedinUrl,
          inferredEmail: candidate.email,
          emailStatus: candidate.status,
          emailConfidence: candidate.confidence,
          emailPattern: candidate.email ? company.emailPattern : null,
          emailSource: candidate.email ? "PATTERN" : null
        },
        update: {
          companyId: company.id,
          positionId,
          currentTitle: profile.currentTitle,
          normalizedTitle: profile.normalizedTitle,
          location: profile.location,
          country: profile.country,
          state: profile.state,
          city: profile.city,
          linkedinUrl: profile.linkedinUrl,
          inferredEmail: candidate.email,
          emailStatus: candidate.status,
          emailConfidence: candidate.confidence,
          emailPattern: candidate.email ? company.emailPattern : null,
          emailSource: candidate.email ? "PATTERN" : null
        }
      });
      processed += 1;
    }

    return processed;
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
   * path). High-confidence results are cached for 7 days to avoid paying for the
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
      await this.regenerateCompanyEmails(userId, company);
      return this.requireOwnedCompany(userId, companyId);
    }

    const limit = await this.emailFormatRateLimiter(userId);
    if (!limit.allowed) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
      throw new ProspectError(
        "RATE_LIMITED",
        `You've reached the AI email-format search limit. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
      );
    }

    return this.inferAndApplyEmailFormat(userId, company, { sourceUrl: null });
  }

  /**
   * Run email-domain/pattern inference for a company, persist the selected
   * format + evidence, and regenerate every person's candidate email. Shared by
   * the source-URL refresh and the AI discovery paths.
   */
  private async inferAndApplyEmailFormat(
    userId: string,
    company: ProspectCompany,
    opts: { sourceUrl?: string | null }
  ): Promise<ProspectCompany> {
    const budget = createAiBudget();

    const inference = await this.emailDomain.infer({
      userId,
      companyId: company.id,
      companyName: company.officialName ?? company.name,
      officialWebsiteDomain: company.officialWebsiteDomain ?? company.officialDomain,
      knownLinkedinUrl: company.linkedinUrl,
      sourceUrl: opts.sourceUrl ?? null,
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
        emailFormatReason: inference.reasonSummary ?? null,
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

function coerceConfidenceLevelSafe(value: string | null | undefined): ConfidenceLevel {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNAVAILABLE";
}

function combinedEmailConfidence(
  emailDomainConfidence: string | null | undefined,
  patternConfidence: string | null | undefined
): ConfidenceLevel {
  const domain = coerceConfidenceLevelSafe(emailDomainConfidence);
  const pattern = coerceConfidenceLevelSafe(patternConfidence);
  if (domain === "UNAVAILABLE" || pattern === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }
  if (domain === "LOW" || pattern === "LOW") {
    return "LOW";
  }
  if (domain === "MEDIUM" || pattern === "MEDIUM") {
    return "MEDIUM";
  }
  return "HIGH";
}
