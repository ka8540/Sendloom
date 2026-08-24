import type { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { coercePositionCategory } from "@/lib/prospect-enums";
import { normalizeLocationsForCache } from "@/services/prospects/discover-cache-fingerprint";
import { filterReusableDiscoverPeople } from "@/services/prospects/discover-cache-reuse";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import {
  OpenAIRoleEmbeddingService,
  type RoleEmbeddingPort
} from "@/services/prospects/role-embedding-service";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import {
  decideRoleMatch,
  deriveRoleIntent,
  providerAliasesForIntent,
  type RoleIntent
} from "@/services/prospects/role-semantic-policy";
import {
  PrismaRoleSemanticStore,
  type RoleSemanticIdentity,
  type RoleSemanticRecord,
  type RoleSemanticSimilarity,
  type RoleSemanticStorePort,
  type RoleSemanticWrite
} from "@/services/prospects/role-semantic-store";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

const ROLE_VECTOR_COLUMN_DIMENSIONS = 1536;
const DEFAULT_TOP_K = 20;

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

export interface DiscoverRoleIntelligencePort {
  readonly enabled: boolean;
  filterAndRankPeople(input: {
    people: readonly ResolvedCachePerson[];
    requestedTitles: readonly string[];
    requestedLocations: readonly string[];
    context: "CACHE" | "PROVIDER";
    options: RoleIntelligenceOptions;
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

function locationMatches(person: ResolvedCachePerson, requestedLocations: readonly string[]): boolean {
  const requested = new Set(normalizeLocationsForCache([...requestedLocations]));
  if (requested.size === 0) return true;
  const personLocations = normalizeLocationsForCache(
    [person.location, person.country, person.state, person.city].filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim())
    )
  );
  return personLocations.some((location) => requested.has(location));
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
    context: "CACHE" | "PROVIDER";
    options: RoleIntelligenceOptions;
  }): Promise<ResolvedCachePerson[]> {
    const requestedIntents = await this.classifyIntents(input.requestedTitles, input.options);
    if (requestedIntents.length === 0) return [];

    if (!this.enabled) {
      return this.currentBehaviorFilter(input.people, requestedIntents, input.requestedLocations);
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
      if (input.context === "CACHE") {
        return this.currentBehaviorFilter(input.people, requestedIntents, input.requestedLocations);
      }
      similarities = new Map();
    }

    const ranked = input.people
      .map((person, index) => {
        if (!locationMatches(person, input.requestedLocations)) return null;
        const normalizedTitle = normalizeTitle(person.normalizedTitle ?? person.currentTitle ?? "");
        const candidate = candidateByTitle.get(normalizedTitle);
        if (!candidate) return null;
        const storedCategory = coercePositionCategory(person.positionCategory);
        if (storedCategory !== "OTHER" && storedCategory !== candidate.category) return null;
        let bestScore = -1;
        let bestKind = "";
        for (const query of requestedIntents) {
          const decision = decideRoleMatch({
            query,
            candidate,
            context: input.context,
            vectorSimilarity: similarities.get(`${query.normalizedTitle}\u0000${candidate.normalizedTitle}`)
          });
          if (decision && decision.score > bestScore) {
            bestScore = decision.score;
            bestKind = decision.kind;
          }
        }
        return bestScore >= 0 ? { person, index, score: bestScore, kind: bestKind } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    safeSemanticEvent(
      ranked.some((entry) => entry.kind === "VECTOR") ? "DISCOVER_ROLE_SEMANTIC_VECTOR" : "DISCOVER_ROLE_SEMANTIC_ALIAS",
      {
        searchId: input.options.searchId ?? null,
        requestedRoleCount: requestedIntents.length,
        semanticCandidateCount: input.people.length,
        semanticAcceptedCount: ranked.length,
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

    let similar: RoleSemanticSimilarity[] = [];
    try {
      await this.ensureSemantics(intents);
      similar = await this.similarRows(intents);
    } catch (error) {
      safeSemanticWarning("provider_plan", options.searchId, error);
      // Provider expansion spends money and therefore uses the strictest
      // fallback: when embeddings/vector lookup are unavailable, preserve the
      // exact pre-feature provider input.
      return exact;
    }

    const result: string[] = [];
    const seen = new Set<string>();
    const perRoleCounts = new Map(intents.map((intent) => [intent.normalizedTitle, 0]));
    const add = (title: string, owner: RoleIntent) => {
      const normalized = normalizeTitle(title);
      const count = perRoleCounts.get(owner.normalizedTitle) ?? 0;
      if (!normalized || seen.has(normalized) || result.length >= this.maxApifyTitlesTotal) return;
      if (count >= this.maxApifyTitlesPerRole) return;
      seen.add(normalized);
      result.push(title.trim());
      perRoleCounts.set(owner.normalizedTitle, count + 1);
    };

    // Preserve every exact requested role first.
    for (const intent of intents) add(intent.rawTitle, intent);
    const semanticByQuery = new Map<string, RoleSemanticSimilarity[]>();
    for (const row of similar) {
      const list = semanticByQuery.get(row.queryKey) ?? [];
      list.push(row);
      semanticByQuery.set(row.queryKey, list);
    }
    const queues = intents.map((intent) => {
      const aliases = providerAliasesForIntent(intent).map((title) => ({ title, intent }));
      const vectors = (semanticByQuery.get(intent.normalizedTitle) ?? [])
        .filter((row) =>
          Boolean(
            decideRoleMatch({
              query: intent,
              candidate: this.intentFromRecord(row),
              context: "PROVIDER",
              vectorSimilarity: row.similarity
            })
          )
        )
        .map((row) => ({ title: row.normalizedTitle, intent }));
      return [...aliases, ...vectors];
    });

    for (let index = 0; result.length < this.maxApifyTitlesTotal; index += 1) {
      let hadCandidate = false;
      for (const queue of queues) {
        const candidate = queue[index];
        if (!candidate) continue;
        hadCandidate = true;
        add(candidate.title, candidate.intent);
        if (result.length >= this.maxApifyTitlesTotal) break;
      }
      if (!hadCandidate) break;
    }

    safeSemanticEvent("DISCOVER_ROLE_PROVIDER_EXPANSION", {
      searchId: options.searchId ?? null,
      requestedRoleCount: intents.length,
      expandedRoleCount: result.length,
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
    requestedLocations: readonly string[]
  ): ResolvedCachePerson[] {
    return filterReusableDiscoverPeople({
      people,
      requestedRoles: requestedIntents.map((intent) => ({
        normalizedTitle: intent.normalizedTitle,
        category: intent.category
      })),
      requestedLocations
    });
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

  private intentFromRecord(record: RoleSemanticRecord): RoleIntent {
    return {
      rawTitle: record.normalizedTitle,
      normalizedTitle: record.normalizedTitle,
      canonicalRoleKey: record.canonicalRoleKey,
      category: record.category,
      specialty: record.specialty,
      breadth: record.breadth,
      classificationConfidence: record.classificationConfidence
    };
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
