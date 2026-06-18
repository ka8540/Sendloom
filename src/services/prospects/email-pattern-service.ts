import { z } from "zod";

import {
  CONFIDENCE_LEVELS,
  EMAIL_PATTERNS,
  type ConfidenceLevel,
  type EmailPattern,
  coerceConfidenceLevel,
  isEmailPattern
} from "@/lib/prospect-enums";
import { type AiCallBudget, type AiClient } from "@/services/prospects/prospect-ai";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

export type EmailPatternEvidenceSource = {
  source: string;
  patterns: Array<{ pattern: string; percentage: number }>;
};

export type EmailPatternResult = {
  selectedPattern: EmailPattern | null;
  confidence: ConfidenceLevel;
  reasonSummary: string | null;
  evidenceCount: number;
};

export type InferEmailPatternInput = {
  company: string;
  domain: string | null | undefined;
  evidence?: EmailPatternEvidenceSource[];
  budget: AiCallBudget;
  searchId?: string | null;
};

const aiPatternSchema = z.object({
  selectedPattern: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS as unknown as [string, ...string[]]),
  reasonSummary: z.string().nullable(),
  evidenceCount: z.number()
});

const AI_PATTERN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["selectedPattern", "confidence", "reasonSummary", "evidenceCount"],
  properties: {
    selectedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    reasonSummary: { type: ["string", "null"] },
    evidenceCount: { type: "number" }
  }
} as const;

const INSTRUCTIONS = [
  "You select the single most likely corporate email-address pattern for a company.",
  `You must choose selectedPattern from exactly this set or null: ${EMAIL_PATTERNS.join(", ")}.`,
  "Patterns use 'first'=first name, 'last'=last name, 'f'=first initial, 'l'=last initial (e.g. flast = jdoe, first.last = jane.doe).",
  "Prefer the highest-evidence pattern when evidence is provided. When you have no evidence, you may use general knowledge of the company but lower the confidence accordingly.",
  "If you cannot determine a pattern, return null with UNAVAILABLE confidence.",
  "Confidence must be one of HIGH, MEDIUM, LOW, UNAVAILABLE."
].join(" ");

export class EmailPatternService {
  constructor(private readonly ai: AiClient) {}

  /**
   * Infer ONE email pattern for the whole company. Runs at most once per
   * company (never per person). Returns the selected pattern and a confidence
   * the caller uses to decide whether to generate addresses.
   */
  async infer(input: InferEmailPatternInput): Promise<EmailPatternResult> {
    const domain = normalizeDomain(input.domain);
    const evidence = input.evidence ?? [];

    if (!domain) {
      return { selectedPattern: null, confidence: "UNAVAILABLE", reasonSummary: null, evidenceCount: 0 };
    }

    if (this.ai.enabled && input.budget.canCall("email_pattern")) {
      input.budget.record("email_pattern");
      try {
        const raw = await this.ai.complete({
          taskType: "email_pattern",
          instructions: INSTRUCTIONS,
          input: JSON.stringify({ company: input.company, domain, evidence }),
          schemaName: "email_pattern",
          jsonSchema: AI_PATTERN_JSON_SCHEMA as unknown as Record<string, unknown>,
          inputItemCount: evidence.length,
          searchId: input.searchId,
          maxOutputTokens: 300
        });

        const parsed = aiPatternSchema.parse(raw);
        const selectedPattern = isEmailPattern(parsed.selectedPattern) ? parsed.selectedPattern : null;
        const confidence: ConfidenceLevel = selectedPattern ? coerceConfidenceLevel(parsed.confidence) : "UNAVAILABLE";

        return {
          selectedPattern,
          confidence,
          reasonSummary: parsed.reasonSummary,
          evidenceCount: evidence.length
        };
      } catch (error) {
        console.warn("[prospect] email pattern AI failed", error instanceof Error ? error.message : error);
      }
    }

    return { selectedPattern: null, confidence: "UNAVAILABLE", reasonSummary: null, evidenceCount: evidence.length };
  }
}
