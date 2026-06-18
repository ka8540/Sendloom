import { z } from "zod";

import { CONFIDENCE_LEVELS, type ConfidenceLevel, coerceConfidenceLevel } from "@/lib/prospect-enums";
import { type AiCallBudget, type AiClient } from "@/services/prospects/prospect-ai";
import {
  isLinkedInCompanyUrl,
  isPersonalEmailDomain,
  normalizeCompanyName,
  normalizeDomain
} from "@/services/prospects/prospect-normalization";

export type CompanyEvidence = {
  sourceUrl: string | null;
  sourceName: string;
  claim: string;
};

export type CompanyResolution = {
  officialName: string;
  normalizedName: string;
  officialWebsiteDomain: string | null;
  /** Backward-compatible alias for officialWebsiteDomain. */
  officialDomain: string | null;
  officialWebsite: string | null;
  linkedinCompanyUrl: string | null;
  domainConfidence: ConfidenceLevel;
  requiresConfirmation: boolean;
  evidence: CompanyEvidence[];
};

export type ResolveCompanyInput = {
  companyName: string;
  providedDomain?: string | null;
  providedLinkedinUrl?: string | null;
  budget: AiCallBudget;
  searchId?: string | null;
};

// Validated against the strict AI output. We never trust this directly: the
// normalized key and final domain are recomputed/guarded below.
const aiCompanyResolutionSchema = z.object({
  officialName: z.string(),
  normalizedName: z.string(),
  officialWebsiteDomain: z.string().nullable(),
  officialWebsite: z.string().nullable(),
  linkedinCompanyUrl: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS as unknown as [string, ...string[]]),
  requiresConfirmation: z.boolean(),
  evidence: z
    .array(
      z.object({
        sourceUrl: z.string().nullable(),
        sourceName: z.string(),
        claim: z.string()
      })
    )
    .default([])
});

const AI_COMPANY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "officialName",
    "normalizedName",
    "officialWebsiteDomain",
    "officialWebsite",
    "linkedinCompanyUrl",
    "confidence",
    "requiresConfirmation",
    "evidence"
  ],
  properties: {
    officialName: { type: "string" },
    normalizedName: { type: "string" },
    officialWebsiteDomain: { type: ["string", "null"] },
    officialWebsite: { type: ["string", "null"] },
    linkedinCompanyUrl: { type: ["string", "null"] },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    requiresConfirmation: { type: "boolean" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceUrl", "sourceName", "claim"],
        properties: {
          sourceUrl: { type: ["string", "null"] },
          sourceName: { type: "string" },
          claim: { type: "string" }
        }
      }
    }
  }
} as const;

const INSTRUCTIONS = [
  "You resolve a user-supplied company name to its official identity.",
  "Return the official company name, public website domain, official website URL, and LinkedIn company URL.",
  "The public website domain is not necessarily the employee email domain. Do not infer employee email domains here.",
  "Never invent a website domain you are not confident about. If you lack sufficient evidence, set confidence to LOW or UNAVAILABLE and requiresConfirmation to true, and leave officialWebsiteDomain null.",
  "Never return a personal mailbox domain (gmail.com, outlook.com, etc.) as a company website domain.",
  "Confidence must be one of HIGH, MEDIUM, LOW, UNAVAILABLE."
].join(" ");

function websiteFromDomain(domain: string): string {
  return `https://www.${domain}`;
}

function pickLinkedInCompanyUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (isLinkedInCompanyUrl(candidate)) {
      return candidate!.trim();
    }
  }
  return null;
}

export class CompanyResolutionService {
  constructor(private readonly ai: AiClient) {}

  async resolve(input: ResolveCompanyInput): Promise<CompanyResolution> {
    const companyName = input.companyName.trim();
    const normalizedName = normalizeCompanyName(companyName);
    const providedDomain = normalizeDomain(input.providedDomain);
    const safeProvidedDomain = providedDomain && !isPersonalEmailDomain(providedDomain) ? providedDomain : null;
    const providedLinkedin = pickLinkedInCompanyUrl(input.providedLinkedinUrl);

    // Deterministic path: a valid company domain was supplied, so no AI is
    // needed. This is HIGH confidence and never consumes the AI budget.
    if (safeProvidedDomain) {
      return {
        officialName: companyName,
        normalizedName,
        officialWebsiteDomain: safeProvidedDomain,
        officialDomain: safeProvidedDomain,
        officialWebsite: websiteFromDomain(safeProvidedDomain),
        linkedinCompanyUrl: providedLinkedin,
        domainConfidence: "HIGH",
        requiresConfirmation: false,
        evidence: [
          {
            sourceUrl: null,
            sourceName: "user-provided website domain",
            claim: `Website domain ${safeProvidedDomain} was supplied with the request.`
          }
        ]
      };
    }

    // AI path: resolve the domain when one was not supplied.
    if (this.ai.enabled && input.budget.canCall("company_resolution")) {
      input.budget.record("company_resolution");
      try {
        const raw = await this.ai.complete({
          taskType: "company_resolution",
          instructions: INSTRUCTIONS,
          input: JSON.stringify({
            requestedCompany: companyName,
            providedDomain: null,
            providedLinkedinUrl: input.providedLinkedinUrl ?? null,
            searchEvidence: []
          }),
          schemaName: "company_resolution",
          jsonSchema: AI_COMPANY_JSON_SCHEMA as unknown as Record<string, unknown>,
          inputItemCount: 1,
          searchId: input.searchId,
          maxOutputTokens: 700
        });

        const parsed = aiCompanyResolutionSchema.parse(raw);
        const aiDomain = normalizeDomain(parsed.officialWebsiteDomain);
        const safeAiDomain = aiDomain && !isPersonalEmailDomain(aiDomain) ? aiDomain : null;
        let confidence = coerceConfidenceLevel(parsed.confidence);

        // Guard: the model must not assert a HIGH-confidence domain without any
        // evidence. With no supporting evidence we cap at MEDIUM.
        if (safeAiDomain && parsed.evidence.length === 0 && confidence === "HIGH") {
          confidence = "MEDIUM";
        }

        // Without a usable domain there is nothing to be confident about.
        const domainConfidence: ConfidenceLevel = safeAiDomain ? confidence : "UNAVAILABLE";
        const requiresConfirmation = parsed.requiresConfirmation || !safeAiDomain || domainConfidence === "LOW";

        const aiWebsite = parsed.officialWebsite?.trim();
        const officialWebsite = aiWebsite && /^https?:\/\//i.test(aiWebsite)
          ? aiWebsite
          : safeAiDomain
            ? websiteFromDomain(safeAiDomain)
            : null;

        return {
          officialName: parsed.officialName.trim() || companyName,
          normalizedName,
          officialWebsiteDomain: safeAiDomain,
          officialDomain: safeAiDomain,
          officialWebsite,
          linkedinCompanyUrl: providedLinkedin ?? pickLinkedInCompanyUrl(parsed.linkedinCompanyUrl),
          domainConfidence,
          requiresConfirmation,
          evidence: parsed.evidence
        };
      } catch (error) {
        // Fall through to the deterministic low-confidence fallback below.
        console.warn("[prospect] company resolution AI failed", error instanceof Error ? error.message : error);
      }
    }

    // Deterministic fallback: no domain, no AI. Requires user confirmation.
    return {
      officialName: companyName,
      normalizedName,
      officialWebsiteDomain: null,
      officialDomain: null,
      officialWebsite: null,
      linkedinCompanyUrl: providedLinkedin,
      domainConfidence: "UNAVAILABLE",
      requiresConfirmation: true,
      evidence: []
    };
  }
}
