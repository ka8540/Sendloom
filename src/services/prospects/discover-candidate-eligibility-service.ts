import { z } from "zod";

import { env } from "@/lib/env";
import { OpenAiProspectClient, type AiCallBudget, type AiClient } from "@/services/prospects/prospect-ai";

export const DISCOVER_CANDIDATE_PROVIDERS = ["FIRECRAWL", "TAVILY", "BRIGHTDATA_GOOGLE", "APIFY"] as const;
export const DISCOVER_CANDIDATE_DECISIONS = ["ACCEPT", "REJECT", "UNCERTAIN"] as const;
export const DISCOVER_CANDIDATE_REASON_CODES = [
  "MATCH",
  "COMPANY_MISMATCH",
  "ROLE_MISMATCH",
  "LOCATION_MISMATCH",
  "FORMER_EMPLOYEE",
  "CURRENT_EMPLOYMENT_UNCLEAR",
  "LOCATION_UNCLEAR",
  "ROLE_UNCLEAR",
  "INSUFFICIENT_EVIDENCE",
  "MALFORMED_RESULT"
] as const;

export type DiscoverCandidateProvider = (typeof DISCOVER_CANDIDATE_PROVIDERS)[number];
export type DiscoverCandidateDecisionValue = (typeof DISCOVER_CANDIDATE_DECISIONS)[number];
export type DiscoverCandidateEvidence = {
  candidateId: string;
  provider: DiscoverCandidateProvider;
  name: string | null;
  url: string | null;
  providerTitle: string | null;
  providerDescription: string | null;
  parsedTitle: string | null;
  parsedCompany: string | null;
  parsedLocation: string | null;
  employmentParserDecision: "CURRENT" | "FORMER" | "CONTRADICTORY" | "INSUFFICIENT" | null;
  locationParserDecision: "MATCH" | "MISMATCH" | "MISSING" | null;
  roleClassifierCategory: string | null;
};

export type DiscoverCandidateSearchIntent = {
  company: string;
  roles: string[];
  locations: string[];
};

export type DiscoverCandidateDecision = {
  candidateId: string;
  decision: DiscoverCandidateDecisionValue;
  companyMatch: boolean;
  roleMatch: boolean;
  locationMatch: boolean;
  currentEmployment: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasonCode: (typeof DISCOVER_CANDIDATE_REASON_CODES)[number];
  matchedRequestedRoles: string[];
};

export type DiscoverCandidateJudgeDiagnostics = {
  aiJudgeCandidateCount: number;
  aiJudgeAcceptedCount: number;
  aiJudgeRejectedCount: number;
  aiJudgeUncertainCount: number;
  aiJudgeFallbackCount: number;
  aiJudgeMissingDecisionCount: number;
  aiAcceptedButUnpersistableCount: number;
  preJudgeMalformedCount: number;
  aiAcceptedDeterministicWouldRejectCount: number;
  aiRejectedDeterministicWouldAcceptCount: number;
};

export function emptyCandidateJudgeDiagnostics(): DiscoverCandidateJudgeDiagnostics {
  return {
    aiJudgeCandidateCount: 0,
    aiJudgeAcceptedCount: 0,
    aiJudgeRejectedCount: 0,
    aiJudgeUncertainCount: 0,
    aiJudgeFallbackCount: 0,
    aiJudgeMissingDecisionCount: 0,
    aiAcceptedButUnpersistableCount: 0,
    preJudgeMalformedCount: 0,
    aiAcceptedDeterministicWouldRejectCount: 0,
    aiRejectedDeterministicWouldAcceptCount: 0
  };
}

const decisionSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(DISCOVER_CANDIDATE_DECISIONS),
  companyMatch: z.boolean(),
  roleMatch: z.boolean(),
  locationMatch: z.boolean(),
  currentEmployment: z.boolean(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  reasonCode: z.enum(DISCOVER_CANDIDATE_REASON_CODES),
  matchedRequestedRoles: z.array(z.string())
}).strict().superRefine((decision, context) => {
  if (decision.decision !== "ACCEPT") return;
  if (
    !decision.companyMatch ||
    !decision.roleMatch ||
    !decision.locationMatch ||
    !decision.currentEmployment ||
    decision.reasonCode !== "MATCH" ||
    decision.matchedRequestedRoles.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ACCEPT requires affirmative eligibility evidence."
    });
  }
});

const responseSchema = z.object({ decisions: z.array(decisionSchema) }).strict();

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "decision", "companyMatch", "roleMatch", "locationMatch",
          "currentEmployment", "confidence", "reasonCode", "matchedRequestedRoles"],
        properties: {
          candidateId: { type: "string" },
          decision: { type: "string", enum: [...DISCOVER_CANDIDATE_DECISIONS] },
          companyMatch: { type: "boolean" },
          roleMatch: { type: "boolean" },
          locationMatch: { type: "boolean" },
          currentEmployment: { type: "boolean" },
          confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          reasonCode: { type: "string", enum: [...DISCOVER_CANDIDATE_REASON_CODES] },
          matchedRequestedRoles: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
} as const;

const INSTRUCTIONS = [
  "You evaluate public professional search results for a people-discovery product.",
  "Evaluate every supplied candidate independently using only supplied evidence.",
  "Determine whether the person currently works at the requested company, performs any requested role or a clearly equivalent professional function, and matches any requested location.",
  "Provider retrieval is not proof. Do not search the web or infer missing facts.",
  "Do not infer location, nationality, age, gender, or ethnicity from a name.",
  "Recruiter equivalents can include Technical Recruiter, Senior Recruiter, Talent Acquisition Partner or Specialist, Recruitment Partner, Technical or Talent Sourcer, and Recruiting Manager when evidence supports it.",
  "Do not treat generic HR as recruiting without recruiting or talent-acquisition evidence. Unrelated functions such as Software Engineer, Product Manager, and Marketing Manager do not match Recruiter.",
  "Former, previous, retired, ex-, alumni, and historical-only employment is not current employment.",
  "Do not invent missing location evidence. Use UNCERTAIN for genuinely insufficient or contradictory evidence.",
  "Return exactly one compact structured decision for every candidate. matchedRequestedRoles may contain only exact strings from search.roles. Return no prose."
].join(" ");

export type DiscoverCandidateEligibilityResult = {
  decisions: Map<string, DiscoverCandidateDecision>;
  diagnostics: DiscoverCandidateJudgeDiagnostics;
  shadow: boolean;
};

export interface DiscoverCandidateEligibilityPort {
  readonly enabled: boolean;
  readonly shadow: boolean;
  evaluate(input: {
    intent: DiscoverCandidateSearchIntent;
    candidates: readonly DiscoverCandidateEvidence[];
    budget: AiCallBudget;
    searchId?: string | null;
  }): Promise<DiscoverCandidateEligibilityResult>;
}

export class DiscoverCandidateEligibilityService implements DiscoverCandidateEligibilityPort {
  readonly enabled: boolean;
  readonly shadow: boolean;
  private readonly batchSize: number;

  constructor(
    private readonly ai: AiClient = new OpenAiProspectClient(),
    options: { enabled?: boolean; shadow?: boolean; batchSize?: number } = {}
  ) {
    this.enabled = options.enabled ?? env.DISCOVER_AI_CANDIDATE_JUDGE_ENABLED;
    this.shadow = options.shadow ?? env.DISCOVER_AI_CANDIDATE_JUDGE_SHADOW;
    this.batchSize = Math.max(1, Math.min(50, Math.floor(options.batchSize ?? env.DISCOVER_AI_CANDIDATE_BATCH_SIZE)));
  }

  async evaluate(input: {
    intent: DiscoverCandidateSearchIntent;
    candidates: readonly DiscoverCandidateEvidence[];
    budget: AiCallBudget;
    searchId?: string | null;
  }): Promise<DiscoverCandidateEligibilityResult> {
    const diagnostics = emptyCandidateJudgeDiagnostics();
    const decisions = new Map<string, DiscoverCandidateDecision>();
    if (!this.enabled || input.candidates.length === 0) return { decisions, diagnostics, shadow: this.shadow };

    diagnostics.aiJudgeCandidateCount = input.candidates.length;
    const requestedRoles = new Set(input.intent.roles);
    for (let offset = 0; offset < input.candidates.length; offset += this.batchSize) {
      const batch = input.candidates.slice(offset, offset + this.batchSize);
      if (!this.ai.enabled || !input.budget.canCall("candidate_eligibility")) {
        diagnostics.aiJudgeFallbackCount += batch.length;
        continue;
      }
      input.budget.record("candidate_eligibility");
      try {
        const raw = await this.ai.complete({
          taskType: "candidate_eligibility",
          instructions: INSTRUCTIONS,
          input: JSON.stringify({ search: input.intent, candidates: batch }),
          schemaName: "discover_candidate_eligibility",
          jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
          inputItemCount: batch.length,
          searchId: input.searchId,
          maxOutputTokens: 500 + batch.length * 220
        });
        const parsed = responseSchema.parse(raw);
        const expected = new Set(batch.map((candidate) => candidate.candidateId));
        const grouped = new Map<string, DiscoverCandidateDecision[]>();
        for (const decision of parsed.decisions) {
          if (!expected.has(decision.candidateId)) continue;
          if (decision.matchedRequestedRoles.some((role) => !requestedRoles.has(role))) continue;
          const entries = grouped.get(decision.candidateId) ?? [];
          entries.push(decision);
          grouped.set(decision.candidateId, entries);
        }
        for (const candidate of batch) {
          const entries = grouped.get(candidate.candidateId) ?? [];
          if (entries.length !== 1) {
            diagnostics.aiJudgeMissingDecisionCount += 1;
            diagnostics.aiJudgeFallbackCount += 1;
            continue;
          }
          const decision = entries[0];
          decisions.set(candidate.candidateId, decision);
          if (decision.decision === "ACCEPT") diagnostics.aiJudgeAcceptedCount += 1;
          else if (decision.decision === "REJECT") diagnostics.aiJudgeRejectedCount += 1;
          else {
            diagnostics.aiJudgeUncertainCount += 1;
            diagnostics.aiJudgeFallbackCount += 1;
          }
        }
      } catch {
        diagnostics.aiJudgeFallbackCount += batch.length;
      }
    }
    return { decisions, diagnostics, shadow: this.shadow };
  }
}
