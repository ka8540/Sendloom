import type { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { coercePositionCategory } from "@/lib/prospect-enums";
import { filterReusableDiscoverPeople } from "@/services/prospects/discover-cache-reuse";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import {
  evaluateDiscoverLocationMatch,
  type DiscoverLocationContext
} from "@/services/prospects/discover-location-matching";
import {
  OpenAIRoleEmbeddingService,
  type RoleEmbeddingPort
} from "@/services/prospects/role-embedding-service";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import {
  buildDeterministicProviderTitlePlan,
  deriveRoleIntent,
  evaluateRoleMatch,
  type RoleIntent,
  type RoleMatchKind,
  type RoleMatchRejectionReason
} from "@/services/prospects/role-semantic-policy";
import {
  PrismaRoleSemanticStore,
  type RoleSemanticIdentity,
  type RoleSemanticSimilarity,
  type RoleSemanticStorePort,
  type RoleSemanticWrite
} from "@/services/prospects/role-semantic-store";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

const ROLE_VECTOR_COLUMN_DIMENSIONS = 1536;
const DEFAULT_TOP_K = 20;
const PUBLIC_INDEX_MAX_TITLES_PER_ROLE = 3;
const PUBLIC_INDEX_MAX_TITLES_TOTAL = 6;

export type DiscoverRoleIntelligenceConfig = RoleSemanticIdentity & {
  enabled: boolean;
  maxApifyTitlesPerRole: number;
  maxApifyTitlesTotal: number;
  topK?: number;
};

export type RoleIntelligenceOptions = {
  budget: AiCallBudget;
  searchId?: string | null;
};

export type DiscoverRoleFilterDiagnostics = {
  roleInputCount: number;
  roleMatchedCount: number;
  roleRejectedCount: number;
  locationConfirmedCount: number;
  locationMissingRejectedCount: number;
  locationContradictionRejectedCount: number;
  locationNoMatchRejectedCount: number;
  finalEligibleCount: number;
};

export interface DiscoverRoleIntelligencePort {
  readonly enabled: boolean;
  filterAndRankPeople(input: {
    people: readonly ResolvedCachePerson[];
    requestedTitles: readonly string[];
    requestedLocations: readonly string[];
    context: DiscoverLocationContext;
    options: RoleIntelligenceOptions;
    onDiagnostics?: (diagnostics: DiscoverRoleFilterDiagnostics) => void;
  }): Promise<ResolvedCachePerson[]>;
  buildProviderTitlePlan(
    requestedTitles: readonly string[],
    options: RoleIntelligenceOptions
  ): Promise<string[]>;
  persistTitleKnowledge(
    rawTitles: readonly string[],
    options: RoleIntelligenceOptions
  ): Promise<{ existing: number; created: number; failed: boolean }>;
}

export function validateRoleIntelligenceConfig(config: DiscoverRoleIntelligenceConfig): DiscoverRoleIntelligenceConfig {
  if (!Number.isInteger(config.embeddingDimensions) || config.embeddingDimensions <= 0) {
    throw new Error("DISCOVER_ROLE_EMBEDDING_DIMENSIONS must be a positive integer.");
  }
  if (config.embeddingDimensions !== ROLE_VECTOR_COLUMN_DIMENSIONS) {
    throw new Error(
      `DISCOVER_ROLE_EMBEDDING_DIMENSIONS must match the vector(${ROLE_VECTOR_COLUMN_DIMENSIONS}) database column.`
    );
  }
  if (!config.embeddingModel.trim()) throw new Error("DISCOVER_ROLE_EMBEDDING_MODEL must be non-empty.");
  if (!config.semanticVersion.trim()) throw new Error("DISCOVER_ROLE_SEMANTIC_VERSION must be non-empty.");
  if (!Number.isInteger(config.maxApifyTitlesPerRole) || config.maxApifyTitlesPerRole < 1 || config.maxApifyTitlesPerRole > 8) {
    throw new Error("DISCOVER_ROLE_MAX_APIFY_TITLES must be between 1 and 8.");
  }
  if (!Number.isInteger(config.maxApifyTitlesTotal) || config.maxApifyTitlesTotal < 1 || config.maxApifyTitlesTotal > 20) {
    throw new Error("DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL must be between 1 and 20.");
  }
  if (config.maxApifyTitlesPerRole > config.maxApifyTitlesTotal) {
    throw new Error("DISCOVER_ROLE_MAX_APIFY_TITLES cannot exceed DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL.");
  }
  return config;
}

function safeSemanticWarning(operation: string, searchId: string | null | undefined, error: unknown): void {
  console.warn("[discover-role-semantic] fallback", {
    operation,
    searchId: searchId ?? null,
    errorType: error instanceof Error ? error.name : "UnknownError"
  });
}

function safeSemanticEvent(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info("[discover-role-semantic]", { event, ...fields });
}

function uniqueTitles(titles: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const title of titles) {
    const normalized = normalizeTitle(title ?? "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(title.trim());
  }
  return result;
}

export class DiscoverRoleIntelligenceService implements DiscoverRoleIntelligencePort {
  readonly enabled: boolean;
  private readonly identity: RoleSemanticIdentity;
  private readonly maxApifyTitlesPerRole: number;
  private readonly maxApifyTitlesTotal: number;
  private readonly topK: number;

  constructor(
    private readonly roleClassifier: RoleClassificationService,
    private readonly embeddings: RoleEmbeddingPort,
    private readonly store: RoleSemanticStorePort,
    config: DiscoverRoleIntelligenceConfig
  ) {
    const validated = validateRoleIntelligenceConfig(config);
    this.enabled = validated.enabled;
    this.identity = {
      embeddingModel: validated.embeddingModel,
      embeddingDimensions: validated.embeddingDimensions,
      semanticVersion: validated.semanticVersion
    };
    this.maxApifyTitlesPerRole = validated.maxApifyTitlesPerRole;
    this.maxApifyTitlesTotal = validated.maxApifyTitlesTotal;
    this.topK = Math.max(1, Math.min(validated.topK ?? DEFAULT_TOP_K, 50));
  }

  async filterAndRankPeople(input: {
    people: readonly ResolvedCachePerson[];
    requestedTitles: readonly string[];
    requestedLocations: readonly string[];
    context: DiscoverLocationContext;
    options: RoleIntelligenceOptions;
    onDiagnostics?: (diagnostics: DiscoverRoleFilterDiagnostics) => void;
  }): Promise<ResolvedCachePerson[]> {
    const requestedIntents = await this.classifyIntents(input.requestedTitles, input.options);
    if (requestedIntents.length === 0) {
      input.onDiagnostics?.({
        roleInputCount: input.people.length,
        roleMatchedCount: 0,
        roleRejectedCount: input.people.length,
        locationConfirmedCount: 0,
        locationMissingRejectedCount: 0,
        locationContradictionRejectedCount: 0,
        locationNoMatchRejectedCount: 0,
        finalEligibleCount: 0
      });
      return [];
    }

    if (!this.enabled) {
      return this.currentBehaviorFilter(
        input.people,
        requestedIntents,
        input.requestedLocations,
        input.context,
        input.onDiagnostics
      );
    }

    const candidateTitles = input.people
      .map((person) => person.normalizedTitle ?? person.currentTitle ?? "")
      .filter(Boolean);
    const candidateIntents = await this.classifyIntents(candidateTitles, input.options);
    const candidateByTitle = new Map(candidateIntents.map((intent) => [intent.normalizedTitle, intent]));

    let similarities: Map<string, number>;
    try {
      await this.ensureSemantics([...requestedIntents, ...candidateIntents]);
      similarities = await this.similarityMap(requestedIntents);
    } catch (error) {
      safeSemanticWarning("rank_people", input.options.searchId, error);
      similarities = new Map();
    }

    const acceptedCounts: Record<RoleMatchKind, number> = {
      EXACT: 0,
      ALIAS: 0,
      FAMILY: 0,
      BROAD_POLICY: 0,
      VECTOR: 0
    };
    const rejectedCounts: Record<RoleMatchRejectionReason, number> = {
      CATEGORY: 0,
      FAMILY: 0,
      LEADERSHIP: 0,
      VECTOR: 0
    };
    const rejectionPriority: Record<RoleMatchRejectionReason, number> = {
      CATEGORY: 1,
      LEADERSHIP: 2,
      FAMILY: 3,
      VECTOR: 4
    };
    let locationRejectedCount = 0;
    let locationConfirmedCount = 0;
    let explicitLocationContradictionCount = 0;
    let missingLocationMetadataCount = 0;
    let locationMissingRejectedCount = 0;
    let locationNoMatchRejectedCount = 0;
    let roleMatchedCount = 0;
    const roleContext = input.context === "CACHE" ? "CACHE" : "PROVIDER";
    const ranked: Array<{
      person: ResolvedCachePerson;
      index: number;
      score: number;
      kind: RoleMatchKind;
    }> = [];

    for (const [index, person] of input.people.entries()) {
      const normalizedTitle = normalizeTitle(person.normalizedTitle ?? person.currentTitle ?? "");
      const candidate = candidateByTitle.get(normalizedTitle);
      if (!candidate) {
        rejectedCounts.FAMILY += 1;
        continue;
      }
      const storedCategory = coercePositionCategory(person.positionCategory);
      if (storedCategory !== "OTHER" && storedCategory !== candidate.category) {
        rejectedCounts.CATEGORY += 1;
        continue;
      }
      let bestScore = -1;
      let bestKind: RoleMatchKind | null = null;
      let bestRejection: RoleMatchRejectionReason = "CATEGORY";
      for (const query of requestedIntents) {
        const evaluation = evaluateRoleMatch({
          query,
          candidate,
          context: roleContext,
          vectorSimilarity: similarities.get(`${query.normalizedTitle}\u0000${candidate.normalizedTitle}`)
        });
        if (evaluation.decision && evaluation.decision.score > bestScore) {
          bestScore = evaluation.decision.score;
          bestKind = evaluation.decision.kind;
        } else if (
          evaluation.rejectionReason &&
          rejectionPriority[evaluation.rejectionReason] > rejectionPriority[bestRejection]
        ) {
          bestRejection = evaluation.rejectionReason;
        }
      }
      if (bestKind) {
        roleMatchedCount += 1;
        const locationEvaluation = evaluateDiscoverLocationMatch({
          candidate: person,
          requestedLocations: input.requestedLocations,
          context: input.context
        });
        if (locationEvaluation.reason === "CONFIRMED") {
          locationConfirmedCount += 1;
        } else if (locationEvaluation.reason === "EXPLICIT_CONTRADICTION") {
          explicitLocationContradictionCount += 1;
        } else if (locationEvaluation.reason === "MISSING_METADATA") {
          missingLocationMetadataCount += 1;
        }
        if (!locationEvaluation.matches) {
          locationRejectedCount += 1;
          if (locationEvaluation.reason === "MISSING_METADATA") {
            locationMissingRejectedCount += 1;
          } else if (locationEvaluation.reason === "NO_MATCH") {
            locationNoMatchRejectedCount += 1;
          }
          continue;
        }
        acceptedCounts[bestKind] += 1;
        ranked.push({ person, index, score: bestScore, kind: bestKind });
      } else {
        rejectedCounts[bestRejection] += 1;
      }
    }
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);

    const diagnostics: DiscoverRoleFilterDiagnostics = {
      roleInputCount: input.people.length,
      roleMatchedCount,
      roleRejectedCount: input.people.length - roleMatchedCount,
      locationConfirmedCount,
      locationMissingRejectedCount,
      locationContradictionRejectedCount: explicitLocationContradictionCount,
      locationNoMatchRejectedCount,
      finalEligibleCount: ranked.length
    };
    input.onDiagnostics?.(diagnostics);

    safeSemanticEvent(
      acceptedCounts.VECTOR > 0
        ? "DISCOVER_ROLE_SEMANTIC_VECTOR"
        : acceptedCounts.FAMILY + acceptedCounts.BROAD_POLICY > 0
          ? "DISCOVER_ROLE_SEMANTIC_POLICY"
          : "DISCOVER_ROLE_SEMANTIC_ALIAS",
      {
        searchId: input.options.searchId ?? null,
        requestedRoleCount: requestedIntents.length,
        semanticCandidateCount: input.people.length,
        semanticAcceptedCount: ranked.length,
        semanticRejectedCount: input.people.length - ranked.length,
        exactAcceptedCount: acceptedCounts.EXACT,
        aliasAcceptedCount: acceptedCounts.ALIAS,
        familyAcceptedCount: acceptedCounts.FAMILY,
        broadPolicyAcceptedCount: acceptedCounts.BROAD_POLICY,
        vectorAcceptedCount: acceptedCounts.VECTOR,
        categoryRejectedCount: rejectedCounts.CATEGORY,
        familyRejectedCount: rejectedCounts.FAMILY,
        leadershipRejectedCount: rejectedCounts.LEADERSHIP,
        explicitLeadershipMismatchCount: rejectedCounts.LEADERSHIP,
        vectorRejectedCount: rejectedCounts.VECTOR,
        roleMatchedCount: diagnostics.roleMatchedCount,
        roleRejectedCount: diagnostics.roleRejectedCount,
        locationRejectedCount,
        locationConfirmedCount,
        locationMissingRejectedCount,
        locationContradictionRejectedCount: explicitLocationContradictionCount,
        locationNoMatchRejectedCount,
        explicitLocationContradictionCount,
        missingLocationMetadataCount,
        finalEligibleCount: ranked.length,
        semanticVersion: this.identity.semanticVersion
      }
    );
    return ranked.map((entry) => entry.person);
  }

  async buildProviderTitlePlan(
    requestedTitles: readonly string[],
    options: RoleIntelligenceOptions
  ): Promise<string[]> {
    const exact = uniqueTitles(requestedTitles);
    if (!this.enabled) return exact;
    const intents = await this.classifyIntents(exact, options);
    if (intents.length === 0) return exact;
    const maxPerRole = Math.min(this.maxApifyTitlesPerRole, PUBLIC_INDEX_MAX_TITLES_PER_ROLE);
    const maxTotal = Math.max(
      intents.length,
      Math.min(this.maxApifyTitlesTotal, PUBLIC_INDEX_MAX_TITLES_TOTAL)
    );
    const result = buildDeterministicProviderTitlePlan({ intents, maxPerRole, maxTotal });

    safeSemanticEvent("DISCOVER_ROLE_PROVIDER_EXPANSION", {
      searchId: options.searchId ?? null,
      requestedRoleCount: intents.length,
      expandedRoleCount: result.length,
      maxTitlesPerRole: maxPerRole,
      maxTitlesTotal: maxTotal,
      vectorNeighborsIncluded: false,
      providerCalled: true,
      semanticVersion: this.identity.semanticVersion
    });
    return result;
  }

  async persistTitleKnowledge(
    rawTitles: readonly string[],
    options: RoleIntelligenceOptions
  ): Promise<{ existing: number; created: number; failed: boolean }> {
    if (!this.enabled) return { existing: 0, created: 0, failed: false };
    try {
      const intents = await this.classifyIntents(rawTitles, options);
      return await this.ensureSemantics(intents);
    } catch (error) {
      safeSemanticWarning("persist_titles", options.searchId, error);
      return { existing: 0, created: 0, failed: true };
    }
  }

  private async classifyIntents(rawTitles: readonly string[], options: RoleIntelligenceOptions): Promise<RoleIntent[]> {
    const unique = uniqueTitles(rawTitles);
    const classifications = await this.roleClassifier.classify(unique, options);
    return unique
      .map((rawTitle) => {
        const normalized = normalizeTitle(rawTitle);
        const classification = classifications.get(normalized);
        return deriveRoleIntent({
          rawTitle,
          category: coercePositionCategory(classification?.category),
          confidence: classification?.confidence
        });
      })
      .filter((intent): intent is RoleIntent => intent !== null);
  }

  private currentBehaviorFilter(
    people: readonly ResolvedCachePerson[],
    requestedIntents: readonly RoleIntent[],
    requestedLocations: readonly string[],
    context: DiscoverLocationContext,
    onDiagnostics?: (diagnostics: DiscoverRoleFilterDiagnostics) => void
  ): ResolvedCachePerson[] {
    const roleMatched = filterReusableDiscoverPeople({
      people,
      requestedRoles: requestedIntents.map((intent) => ({
        normalizedTitle: intent.normalizedTitle,
        category: intent.category
      })),
      requestedLocations: []
    });
    let locationConfirmedCount = 0;
    let locationMissingRejectedCount = 0;
    let locationContradictionRejectedCount = 0;
    let locationNoMatchRejectedCount = 0;
    const eligible = roleMatched.filter((person) => {
      const location = evaluateDiscoverLocationMatch({
        candidate: person,
        requestedLocations,
        context
      });
      if (location.reason === "CONFIRMED") locationConfirmedCount += 1;
      if (!location.matches && location.reason === "MISSING_METADATA") locationMissingRejectedCount += 1;
      if (!location.matches && location.reason === "EXPLICIT_CONTRADICTION") {
        locationContradictionRejectedCount += 1;
      }
      if (!location.matches && location.reason === "NO_MATCH") locationNoMatchRejectedCount += 1;
      return location.matches;
    });
    onDiagnostics?.({
      roleInputCount: people.length,
      roleMatchedCount: roleMatched.length,
      roleRejectedCount: people.length - roleMatched.length,
      locationConfirmedCount,
      locationMissingRejectedCount,
      locationContradictionRejectedCount,
      locationNoMatchRejectedCount,
      finalEligibleCount: eligible.length
    });
    return eligible;
  }

  private async ensureSemantics(
    intents: readonly RoleIntent[]
  ): Promise<{ existing: number; created: number; failed: boolean }> {
    const unique = new Map(intents.map((intent) => [intent.normalizedTitle, intent]));
    const existing = await this.store.findByTitles([...unique.keys()], this.identity);
    const missing = [...unique.values()].filter((intent) => !existing.has(intent.normalizedTitle));
    if (missing.length === 0) return { existing: existing.size, created: 0, failed: false };
    if (!this.embeddings.enabled) throw new Error("Role embedding provider is unavailable.");
    const vectors = await this.embeddings.embedTitles(missing.map((intent) => intent.normalizedTitle));
    const writes: RoleSemanticWrite[] = missing.map((intent) => {
      const embedding = vectors.get(intent.normalizedTitle);
      if (!embedding) throw new Error("Role embedding batch omitted a requested title.");
      return {
        normalizedTitle: intent.normalizedTitle,
        canonicalRoleKey: intent.canonicalRoleKey,
        category: intent.category,
        specialty: intent.specialty,
        breadth: intent.breadth,
        classificationConfidence: intent.classificationConfidence,
        ...this.identity,
        embedding
      };
    });
    await this.store.upsertMany(writes);
    return { existing: existing.size, created: writes.length, failed: false };
  }

  private async similarRows(intents: readonly RoleIntent[]): Promise<RoleSemanticSimilarity[]> {
    const vectors = await this.store.findVectorsByTitles(
      intents.map((intent) => intent.normalizedTitle),
      this.identity
    );
    return this.store.findSimilarMany(
      intents.flatMap((intent) => {
        const semantic = vectors.get(intent.normalizedTitle);
        return semantic ? [{ queryKey: intent.normalizedTitle, category: intent.category, embedding: semantic.embedding }] : [];
      }),
      this.identity,
      this.topK
    );
  }

  private async similarityMap(intents: readonly RoleIntent[]): Promise<Map<string, number>> {
    const rows = await this.similarRows(intents);
    return new Map(rows.map((row) => [`${row.queryKey}\u0000${row.normalizedTitle}`, row.similarity]));
  }

}

export function createDiscoverRoleIntelligenceService(
  prisma: PrismaClient,
  roleClassifier: RoleClassificationService,
  overrides: Partial<DiscoverRoleIntelligenceConfig> = {}
): DiscoverRoleIntelligenceService {
  return new DiscoverRoleIntelligenceService(
    roleClassifier,
    new OpenAIRoleEmbeddingService({
      apiKey: env.OPENAI_API_KEY,
      model: env.DISCOVER_ROLE_EMBEDDING_MODEL,
      dimensions: env.DISCOVER_ROLE_EMBEDDING_DIMENSIONS
    }),
    new PrismaRoleSemanticStore(prisma),
    {
      enabled: env.DISCOVER_ROLE_VECTOR_ENABLED,
      embeddingModel: env.DISCOVER_ROLE_EMBEDDING_MODEL,
      embeddingDimensions: env.DISCOVER_ROLE_EMBEDDING_DIMENSIONS,
      semanticVersion: env.DISCOVER_ROLE_SEMANTIC_VERSION,
      maxApifyTitlesPerRole: env.DISCOVER_ROLE_MAX_APIFY_TITLES,
      maxApifyTitlesTotal: env.DISCOVER_ROLE_MAX_APIFY_TITLES_TOTAL,
      ...overrides
    }
  );
}
