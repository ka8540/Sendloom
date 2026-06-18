import type { PrismaClient, ProspectCompany, ProspectSearch } from "@prisma/client";

import { env } from "@/lib/env";
import { type PositionCategory, coercePositionCategory, displayNameForCategory } from "@/lib/prospect-enums";
import {
  ApifyProfileSearchService,
  type NormalizedProfile
} from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService, type CompanyResolution } from "@/services/prospects/company-resolution-service";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { EmailPatternService } from "@/services/prospects/email-pattern-service";
import { AiCallBudget, createAiBudget } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
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
  emailPattern: EmailPatternService;
  pipelineTimeoutMs?: number;
};

export class ProspectSearchService {
  private readonly prisma: PrismaClient;
  private readonly apify: ApifyProfileSearchService;
  private readonly companyResolution: CompanyResolutionService;
  private readonly roleClassifier: RoleClassificationService;
  private readonly emailPattern: EmailPatternService;
  private readonly pipelineTimeoutMs: number;

  constructor(deps: ProspectSearchServiceDeps) {
    this.prisma = deps.prisma;
    this.apify = deps.apify;
    this.companyResolution = deps.companyResolution;
    this.roleClassifier = deps.roleClassifier;
    this.emailPattern = deps.emailPattern;
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

    // 4) Infer ONE company email pattern.
    await this.setStatus(search.id, "INFERRING_EMAIL_PATTERN");
    const pattern = await this.emailPattern.infer({
      company: resolution.officialName,
      domain: company.officialDomain,
      evidence: [],
      budget,
      searchId: search.id
    });

    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: company.id },
      data: {
        emailPattern: pattern.selectedPattern,
        patternConfidence: pattern.confidence,
        patternEvidence: pattern.reasonSummary
          ? [{ pattern: pattern.selectedPattern, reason: pattern.reasonSummary, evidenceCount: pattern.evidenceCount }]
          : undefined
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
        officialDomain: resolution.officialDomain,
        officialWebsite: resolution.officialWebsite,
        linkedinUrl: resolution.linkedinCompanyUrl,
        domainConfidence: resolution.domainConfidence,
        patternConfidence: "UNAVAILABLE"
      },
      update: {
        name: resolution.officialName,
        officialName: resolution.officialName,
        officialDomain: resolution.officialDomain,
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
    const patternConfidence = coerceConfidenceLevelSafe(company.patternConfidence);
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
        domain: company.officialDomain,
        pattern: company.emailPattern,
        patternConfidence,
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

  /** Re-run email-pattern inference and regenerate every person's email. */
  async reinferCompanyEmailPattern(userId: string, companyId: string): Promise<ProspectCompany> {
    const company = await this.requireOwnedCompany(userId, companyId);
    const budget = createAiBudget();

    const pattern = await this.emailPattern.infer({
      company: company.officialName ?? company.name,
      domain: company.officialDomain,
      evidence: [],
      budget,
      searchId: null
    });

    const updatedCompany = await this.prisma.prospectCompany.update({
      where: { id: company.id },
      data: {
        emailPattern: pattern.selectedPattern,
        patternConfidence: pattern.confidence,
        patternEvidence: pattern.reasonSummary
          ? [{ pattern: pattern.selectedPattern, reason: pattern.reasonSummary, evidenceCount: pattern.evidenceCount }]
          : undefined
      }
    });

    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const patternConfidence = coerceConfidenceLevelSafe(updatedCompany.patternConfidence);
    const people = await this.prisma.prospectPerson.findMany({ where: { companyId, userId } });

    for (const person of people) {
      const candidate = resolveCandidateEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        domain: updatedCompany.officialDomain,
        pattern: updatedCompany.emailPattern,
        patternConfidence,
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

    return updatedCompany;
  }
}

function coerceConfidenceLevelSafe(value: string) {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNAVAILABLE";
}
