import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { env } from "@/lib/env";
import {
  CONFIDENCE_LEVELS,
  POSITION_CATEGORIES,
  type ConfidenceLevel,
  type PositionCategory,
  coerceConfidenceLevel,
  coercePositionCategory,
  displayNameForCategory
} from "@/lib/prospect-enums";
import { type AiCallBudget, type AiClient } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";

export type TitleSource = "DETERMINISTIC" | "CACHE" | "AI" | "FALLBACK";

export type TitleClassification = {
  normalizedTitle: string;
  category: PositionCategory;
  displayName: string;
  confidence: ConfidenceLevel;
  source: TitleSource;
};

type DeterministicRule = {
  category: PositionCategory;
  /** Substring phrases (matched anywhere in the normalized title). */
  phrases?: string[];
  /** Short tokens matched only on word boundaries to avoid false positives. */
  words?: string[];
};

// Ordered most-specific first. The first matching rule wins, so e.g. "data
// engineer" must precede the generic software-engineering rule, and HR must
// precede the generic operations rule.
const DETERMINISTIC_RULES: DeterministicRule[] = [
  { category: "RECRUITING", phrases: ["technical recruiter", "recruiter", "talent acquisition", "talent partner", "sourcer"] },
  {
    category: "HUMAN_RESOURCES",
    phrases: ["human resources", "people operations", "people ops", "people partner", "hr business partner", "hr manager", "hr generalist", "hr specialist", "compensation and benefits"],
    words: ["hr", "hrbp"]
  },
  { category: "DATA_SCIENCE", phrases: ["data scientist", "data science", "machine learning", "applied scientist", "research scientist"], words: ["ml"] },
  { category: "DATA_ENGINEERING", phrases: ["data engineer", "analytics engineer", "etl developer", "data platform engineer"] },
  { category: "DATA_ANALYTICS", phrases: ["data analyst", "data analytics", "business intelligence", "bi analyst", "data insights", "insights analyst", "analytics specialist"] },
  {
    category: "SOFTWARE_ENGINEERING",
    phrases: ["software engineer", "software developer", "backend engineer", "back end engineer", "frontend engineer", "front end engineer", "full stack", "fullstack", "site reliability", "platform engineer", "mobile engineer", "ios engineer", "android engineer", "devops engineer", "systems engineer", "programmer", "web developer"],
    words: ["sde", "swe", "sre", "devops"]
  },
  { category: "PRODUCT", phrases: ["product manager", "product owner", "product lead", "head of product", "group product manager"] },
  { category: "DESIGN", phrases: ["designer", "ux ", "user experience", "user interface", "design lead", "creative director"], words: ["ux", "ui"] },
  { category: "MARKETING", phrases: ["marketing", "growth", "demand generation", "content strategist", "brand manager", "seo specialist", "social media"] },
  { category: "SALES", phrases: ["sales", "account executive", "account manager", "business development", "sales development"], words: ["bdr", "sdr"] },
  { category: "FINANCE", phrases: ["finance", "financial analyst", "accountant", "accounting", "controller", "fp&a", "treasury"] },
  { category: "OPERATIONS", phrases: ["operations", "operating", "logistics", "supply chain"], words: ["ops"] },
  { category: "MANAGEMENT", phrases: ["chief executive", "chief technology", "chief financial", "chief operating", "chief marketing", "founder", "co-founder", "vice president", "vp of", "general manager"], words: ["ceo", "cto", "cfo", "coo", "cmo", "cpo"] }
];

function matchesRule(normalizedTitle: string, rule: DeterministicRule): boolean {
  if (rule.phrases?.some((phrase) => normalizedTitle.includes(phrase))) {
    return true;
  }
  if (rule.words?.some((word) => new RegExp(`\\b${word}\\b`).test(normalizedTitle))) {
    return true;
  }
  return false;
}

/** Deterministic, no-AI category for a known title shape, or null if unknown. */
export function deterministicCategory(normalizedTitle: string): PositionCategory | null {
  for (const rule of DETERMINISTIC_RULES) {
    if (matchesRule(normalizedTitle, rule)) {
      return rule.category;
    }
  }
  return null;
}

const aiClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      rawTitle: z.string(),
      normalizedTitle: z.string(),
      category: z.string(),
      displayName: z.string(),
      confidence: z.enum(CONFIDENCE_LEVELS as unknown as [string, ...string[]])
    })
  )
});

const AI_ROLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classifications"],
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawTitle", "normalizedTitle", "category", "displayName", "confidence"],
        properties: {
          rawTitle: { type: "string" },
          normalizedTitle: { type: "string" },
          category: { type: "string", enum: [...POSITION_CATEGORIES] },
          displayName: { type: "string" },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] }
        }
      }
    }
  }
} as const;

const INSTRUCTIONS = [
  "You classify job titles into a fixed set of position categories.",
  `Allowed categories: ${POSITION_CATEGORIES.join(", ")}.`,
  "Use OTHER only when no category fits. Never invent a category outside the allowed set.",
  "Classify every title you are given exactly once.",
  "Confidence must be one of HIGH, MEDIUM, LOW, UNAVAILABLE."
].join(" ");

function buildClassification(
  normalizedTitle: string,
  category: PositionCategory,
  confidence: ConfidenceLevel,
  source: TitleSource
): TitleClassification {
  return {
    normalizedTitle,
    category,
    displayName: displayNameForCategory(category),
    confidence,
    source
  };
}

export class RoleClassificationService {
  constructor(
    private readonly prisma: Pick<PrismaClient, "prospectTitleClassification">,
    private readonly ai: AiClient
  ) {}

  /**
   * Classify a list of raw job titles. The expensive model call is made at most
   * once and only for titles that are neither covered by the deterministic map
   * nor already cached. Returns a map keyed by normalized title.
   */
  async classify(
    rawTitles: string[],
    options: { budget: AiCallBudget; searchId?: string | null }
  ): Promise<Map<string, TitleClassification>> {
    const result = new Map<string, TitleClassification>();

    // 1) Collapse to unique normalized titles, remembering one representative
    // original title for the AI prompt.
    const representatives = new Map<string, string>();
    for (const raw of rawTitles) {
      const normalized = normalizeTitle(raw ?? "");
      if (!normalized) {
        continue;
      }
      if (!representatives.has(normalized)) {
        representatives.set(normalized, raw.trim());
      }
    }

    const unknown: string[] = [];

    // 2) Deterministic map (free).
    for (const normalized of representatives.keys()) {
      const category = deterministicCategory(normalized);
      if (category) {
        result.set(normalized, buildClassification(normalized, category, "HIGH", "DETERMINISTIC"));
      } else {
        unknown.push(normalized);
      }
    }

    // 3) Database cache (free, cross-search/company).
    if (unknown.length > 0) {
      const cached = await this.prisma.prospectTitleClassification.findMany({
        where: { normalizedTitle: { in: unknown } }
      });
      const cachedByTitle = new Map(cached.map((row) => [row.normalizedTitle, row]));
      const stillUnknown: string[] = [];
      for (const normalized of unknown) {
        const row = cachedByTitle.get(normalized);
        if (row) {
          result.set(
            normalized,
            buildClassification(normalized, coercePositionCategory(row.category), coerceConfidenceLevel(row.confidence), "CACHE")
          );
        } else {
          stillUnknown.push(normalized);
        }
      }
      unknown.length = 0;
      unknown.push(...stillUnknown);
    }

    // 4) One batched AI call for whatever is left, capped by the unique-title
    // budget. Anything over the cap falls back to OTHER without a model call.
    if (unknown.length > 0) {
      const cap = env.PROSPECT_AI_MAX_UNIQUE_TITLES;
      const toClassify = unknown.slice(0, cap);
      const overflow = unknown.slice(cap);

      let aiHandled = new Set<string>();
      if (toClassify.length > 0 && this.ai.enabled && options.budget.canCall("role_classification")) {
        options.budget.record("role_classification");
        try {
          const raw = await this.ai.complete({
            taskType: "role_classification",
            instructions: INSTRUCTIONS,
            input: JSON.stringify(toClassify.map((normalized) => representatives.get(normalized) ?? normalized)),
            schemaName: "role_classification",
            jsonSchema: AI_ROLE_JSON_SCHEMA as unknown as Record<string, unknown>,
            inputItemCount: toClassify.length,
            searchId: options.searchId,
            maxOutputTokens: 1500
          });

          const parsed = aiClassificationSchema.parse(raw);
          const toClassifySet = new Set(toClassify);
          const persist: TitleClassification[] = [];

          for (const entry of parsed.classifications) {
            const normalized = normalizeTitle(entry.normalizedTitle || entry.rawTitle);
            if (!toClassifySet.has(normalized) || result.has(normalized)) {
              continue;
            }
            const category = coercePositionCategory(entry.category);
            const classification = buildClassification(normalized, category, coerceConfidenceLevel(entry.confidence), "AI");
            result.set(normalized, classification);
            persist.push(classification);
            aiHandled.add(normalized);
          }

          await this.persistCache(persist);
        } catch (error) {
          console.warn("[prospect] role classification AI failed", error instanceof Error ? error.message : error);
        }
      }

      // Fallback for AI-disabled / over-budget / unreturned / overflow titles.
      for (const normalized of [...toClassify, ...overflow]) {
        if (!result.has(normalized)) {
          result.set(normalized, buildClassification(normalized, "OTHER", "LOW", "FALLBACK"));
        }
      }
    }

    return result;
  }

  private async persistCache(classifications: TitleClassification[]): Promise<void> {
    await Promise.all(
      classifications.map((classification) =>
        this.prisma.prospectTitleClassification.upsert({
          where: { normalizedTitle: classification.normalizedTitle },
          create: {
            normalizedTitle: classification.normalizedTitle,
            category: classification.category,
            displayName: classification.displayName,
            confidence: classification.confidence,
            source: "AI"
          },
          update: {
            category: classification.category,
            displayName: classification.displayName,
            confidence: classification.confidence,
            source: "AI"
          }
        })
      )
    );
  }
}
