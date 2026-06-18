import type { PrismaClient, ProspectCompany, ProspectSearch } from "@prisma/client";

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
import { AiCallBudget, createAiBudget } from "@/services/prospects/prospect-ai";
import { normalizeDomain, normalizeTitle } from "@/services/prospects/prospect-normalization";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";
import type { ValidatedCreateProspectSearch } from "@/services/prospects/prospect-validation";

export type ProspectErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "COMPANY_UNRESOLVED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED";

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

function hasConfiguredEmailFormatSearchProvider(): boolean {
  if (env.WEB_SEARCH_PROVIDER === "serper") {
    return Boolean(env.SERPER_API_KEY);
  }
  if (env.WEB_SEARCH_PROVIDER === "brave") {
    return Boolean(env.BRAVE_SEARCH_API_KEY);
  }
  return false;
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
};

export class ProspectSearchService {
  private readonly prisma: PrismaClient;
  private readonly apify: ApifyProfileSearchService;
  private readonly companyResolution: CompanyResolutionService;
  private readonly roleClassifier: RoleClassificationService;
  private readonly emailDomain: EmailDomainService;
  private readonly pipelineTimeoutMs: number;

  constructor(deps: ProspectSearchServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.companyResolution = deps.companyResolution;
    this.roleClassifier = deps.roleClassifier;
    this.emailDomain = deps.emailDomain;
    this.pipelineTimeoutMs = deps.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS;
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
        maxResults: input.maxResults,
        status: "DRAFT"
      }
    });
  }

  /** Effective result cap = the smaller of the request and the local ceiling. */
  private effectiveMaxResults(requested: number): number {
    return Math.max(1, Math.min(requested, env.LOCAL_PROSPECT_MAX_RESULTS));
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
   */
  async processSearch(userId: string, searchId: string): Promise<ProspectSearch> {
    const search = await this.requireOwnedSearch(userId, searchId);

    if (search.status === "READY") {
      return search;
    }
    if (TERMINAL_STATUSES.has(search.status)) {
      throw new ProspectError("INVALID_STATE", `A ${search.status} search cannot be processed.`);
    }

    const budget = createAiBudget();

    try {
      return await withTimeout(
        this.runPipeline(userId, search, budget),
        this.pipelineTimeoutMs,
        () => new ProspectError("PROVIDER_TIMEOUT", "The profile search timed out. Try again with fewer results.")
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

    // 2) Discover people via Apify.
    await this.setStatus(search.id, "SEARCHING_PEOPLE");
    const maxResults = this.effectiveMaxResults(search.maxResults);
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
        patternEvidence: inference.patternEvidence
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
    if (!trimmedSourceUrl && !hasConfiguredEmailFormatSearchProvider()) {
      throw new ProspectError(
        "NOT_CONFIGURED",
        "No web search provider configured. Paste a public email-format source URL or set WEB_SEARCH_PROVIDER to serper/brave with its API key."
      );
    }
    const budget = createAiBudget();

    const inference = await this.emailDomain.infer({
      userId,
      companyId,
      companyName: company.officialName ?? company.name,
      officialWebsiteDomain: company.officialWebsiteDomain ?? company.officialDomain,
      sourceUrl: trimmedSourceUrl,
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
        patternEvidence: inference.patternEvidence
      }
    });

    await this.regenerateCompanyEmails(userId, updatedCompany);
    return this.requireOwnedCompany(userId, companyId);
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
        patternEvidence: [manualEvidence.patternEvidence]
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
