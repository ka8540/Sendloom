// AI web-search email-format discovery.
//
// Primary discovery path for a company's *employee* email format. It uses
// GPT-5.5 via the OpenAI Responses API with the built-in `web_search` tool to
// find PUBLIC email-format evidence (RocketReach / Hunter-style pages), then
// returns STRUCTURED evidence only. The AI never generates a person's email and
// never runs per person — it runs once per company.
//
// The backend (deterministic selection in email-domain-service + the validator
// below) decides the final email domain + pattern from the evidence. The model's
// own proposed selection is validated, used for logging/UX, and is never trusted
// blindly: a domain or pattern must appear in the evidence, personal mailboxes
// are rejected, and inferred results are never marked verified.
//
// Chat Completions is intentionally not used. No Serper/Brave/Google CSE is used
// for this path. A pasted source URL (handled by email-format-discovery-service)
// remains the manual fallback and short-circuits the web search.

import { z } from "zod";

import { env } from "@/lib/env";
import {
  EMAIL_FORMAT_DECISION_CODES,
  type EmailFormatDecisionCode
} from "@/lib/email-format-decision";
import {
  CONFIDENCE_LEVELS,
  EMAIL_PATTERNS,
  type ConfidenceLevel,
  type EmailPattern,
  coerceConfidenceLevel
} from "@/lib/prospect-enums";
import {
  type EmailDomainEvidence,
  type EmailEvidenceBundle,
  type EmailEvidenceProvider,
  type EmailEvidenceProviderInput,
  type EmailEvidenceSourceType,
  type EmailPatternEvidence,
  isAllowedBusinessEmailDomain
} from "@/services/prospects/email-domain-service";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

// The discovery model defaults to GPT-5.5; override with PROSPECT_AI_MODEL.
export const DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL = "gpt-5.5";

export const EMAIL_FORMAT_MAX_OUTPUT_TOKENS = 400;
export const EMAIL_FORMAT_MAX_SOURCES = 5;

// AI-facing source categories (kept separate from the internal evidence source
// weights so the model has a small, well-defined vocabulary).
export const DISCOVERY_SOURCE_TYPES = [
  "rocketreach",
  "hunter",
  "public_format_page",
  "public_company_page",
  "search_result",
  "other"
] as const;

export type DiscoverySourceType = (typeof DISCOVERY_SOURCE_TYPES)[number];

export type EmailFormatEvidenceItem = {
  label: string;
  url: string;
  sourceType: DiscoverySourceType;
  claimedDomain: string | null;
  claimedPattern: EmailPattern | null;
  percentage: number | null;
  exampleEmail: string | null;
};

export type EmailFormatDiscoveryResult = {
  selectedEmailDomain: string | null;
  selectedPattern: EmailPattern | null;
  domainConfidence: ConfidenceLevel;
  patternConfidence: ConfidenceLevel;
  supportingSources: EmailFormatEvidenceItem[];
  conflictingSourceCount: number;
  decisionCode: EmailFormatDecisionCode;
};

// Strict JSON schema for the Responses API structured output. Every property is
// required and nullable via type unions (the strict-mode contract), mirroring
// the existing prospect AI schemas.
export const OPENAI_EMAIL_FORMAT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "selectedEmailDomain",
    "selectedPattern",
    "domainConfidence",
    "patternConfidence",
    "supportingSources",
    "conflictingSourceCount",
    "decisionCode"
  ],
  properties: {
    selectedEmailDomain: { type: ["string", "null"] },
    selectedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
    domainConfidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    patternConfidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    supportingSources: {
      type: "array",
      maxItems: EMAIL_FORMAT_MAX_SOURCES,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "url",
          "sourceType",
          "claimedDomain",
          "claimedPattern",
          "percentage",
          "exampleEmail"
        ],
        properties: {
          label: { type: "string" },
          url: { type: "string" },
          sourceType: { type: "string", enum: [...DISCOVERY_SOURCE_TYPES] },
          claimedDomain: { type: ["string", "null"] },
          claimedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
          percentage: { type: ["number", "null"], minimum: 0, maximum: 100 },
          exampleEmail: { type: ["string", "null"] },
        }
      }
    },
    conflictingSourceCount: { type: "integer", minimum: 0 },
    decisionCode: { type: "string", enum: [...EMAIL_FORMAT_DECISION_CODES] }
  }
} as const;

const discoverySourceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().url(),
  sourceType: z.enum(DISCOVERY_SOURCE_TYPES),
  claimedDomain: z.string().nullable(),
  claimedPattern: z.enum(EMAIL_PATTERNS).nullable(),
  percentage: z.number().min(0).max(100).nullable(),
  exampleEmail: z.string().nullable()
}).strict();

const discoveryResultSchema = z.object({
  selectedEmailDomain: z.string().nullable(),
  selectedPattern: z.enum(EMAIL_PATTERNS).nullable(),
  domainConfidence: z.enum(CONFIDENCE_LEVELS),
  patternConfidence: z.enum(CONFIDENCE_LEVELS),
  supportingSources: z.array(discoverySourceSchema).max(EMAIL_FORMAT_MAX_SOURCES),
  conflictingSourceCount: z.number().int().nonnegative(),
  decisionCode: z.enum(EMAIL_FORMAT_DECISION_CODES)
}).strict();

export const OPENAI_EMAIL_FORMAT_INSTRUCTIONS = [
  "You are finding a company's public work email format.",
  "Rules:",
  "1. Search the web only when the supplied structured evidence is insufficient.",
  "2. Prefer public email-format pages such as RocketReach/Hunter-style format pages.",
  "3. Extract the email domain from example work emails.",
  "4. Do not assume the website domain is the email domain.",
  "5. Website domain and employee email domain can differ (e.g. website appliedmaterials.com, email domain amat.com).",
  "6. Select the highest-confidence supported pattern only when sources support it.",
  "7. Never fabricate a percentage.",
  "8. Never fabricate a source URL.",
  "9. Never mark inferred emails as verified.",
  "10. If evidence is weak, return LOW or UNAVAILABLE.",
  "11. Do not collect phone numbers.",
  "12. Do not collect personal email domains.",
  "13. Do not return Gmail/Yahoo/Outlook/iCloud personal domains.",
  "14. selectedPattern and claimedPattern must be one of: " + EMAIL_PATTERNS.join(", ") + ".",
  "15. Return at most 5 unique useful sources.",
  "16. Do not return quotes, snippets, prose, rationale, summaries, employee lists, or repeated claims.",
  "17. Return strict JSON only."
].join("\n");

export type EmailFormatDiscoveryInput = {
  companyName: string;
  websiteDomain: string | null;
};

// Suggested public-source queries handed to the model as hints. The model is
// free to run its own; these just bias it toward format pages and the email
// domain (which can differ from the website domain).
export function buildEmailFormatDiscoveryQueries(companyName: string, websiteDomain: string | null): string[] {
  const queries = [
    `${companyName} email format`,
    `${companyName} employee email format`,
    `${companyName} work email format`,
    `${companyName} email pattern`,
    `site:rocketreach.co ${companyName} Email Format`,
    `site:hunter.io ${companyName} email format`
  ];
  if (websiteDomain) {
    queries.push(`${websiteDomain} email format`);
  }
  return queries;
}

export function buildEmailFormatDiscoveryInput(input: EmailFormatDiscoveryInput): Record<string, unknown> {
  return {
    company: input.companyName,
    websiteDomain: input.websiteDomain,
    suggestedQueries: buildEmailFormatDiscoveryQueries(input.companyName, input.websiteDomain).slice(0, 4)
  };
}

// Map an AI source category onto the internal evidence source weight bucket.
function internalSourceType(sourceType: DiscoverySourceType): EmailEvidenceSourceType {
  switch (sourceType) {
    case "hunter":
      return "hunter";
    case "rocketreach":
    case "public_format_page":
      return "public_format_page";
    default:
      return "search_snippet";
  }
}

function emailDomainOf(email: string | null): string | null {
  if (!email) {
    return null;
  }
  const at = email.indexOf("@");
  if (at < 0) {
    return null;
  }
  return normalizeDomain(email.slice(at + 1));
}

function rowConfidence(
  percentage: number | null,
  sourceType: EmailEvidenceSourceType,
  hasExample: boolean
): ConfidenceLevel {
  if (percentage !== null && percentage >= 75) {
    return "HIGH";
  }
  if (hasExample && (sourceType === "hunter" || sourceType === "public_format_page")) {
    return "HIGH";
  }
  if (percentage !== null && percentage >= 35) {
    return "MEDIUM";
  }
  if (sourceType === "hunter" || sourceType === "public_format_page") {
    return "MEDIUM";
  }
  return "LOW";
}

/**
 * Strictly validate and clean the compact model response. Invalid structure,
 * unsupported patterns, personal domains, duplicate sources, and selections
 * absent from evidence are rejected so the caller can retry once, then fall
 * back safely.
 */
export function validateDiscoveryResult(raw: unknown): EmailFormatDiscoveryResult {
  const parsed = discoveryResultSchema.parse(raw);
  const seen = new Set<string>();
  const supportingSources = parsed.supportingSources.flatMap((source) => {
    const exampleEmail = source.exampleEmail?.trim().toLowerCase() || null;
    const exampleDomain = emailDomainOf(exampleEmail);
    const claimedDomain = normalizeDomain(source.claimedDomain);
    const domain = exampleDomain ?? claimedDomain;
    if (domain && !isAllowedBusinessEmailDomain(domain)) {
      return [];
    }

    const canonicalUrl = new URL(source.url);
    canonicalUrl.hash = "";
    const item: EmailFormatEvidenceItem = {
      label: source.label,
      url: canonicalUrl.toString(),
      sourceType: source.sourceType,
      claimedDomain: domain,
      claimedPattern: source.claimedPattern,
      percentage: source.percentage,
      exampleEmail: exampleDomain ? exampleEmail : null
    };
    const key = `${canonicalUrl.hostname.toLowerCase()}${canonicalUrl.pathname.replace(/\/$/, "")}|${domain ?? ""}|${source.claimedPattern ?? ""}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [item];
  });

  const selectedEmailDomain = normalizeDomain(parsed.selectedEmailDomain);
  if (selectedEmailDomain && !isAllowedBusinessEmailDomain(selectedEmailDomain)) {
    throw new Error("The selected email domain is not a business domain.");
  }
  if (
    selectedEmailDomain &&
    !supportingSources.some((source) => source.claimedDomain === selectedEmailDomain)
  ) {
    throw new Error("The selected email domain is absent from supporting evidence.");
  }
  if (
    parsed.selectedPattern &&
    !supportingSources.some((source) => source.claimedPattern === parsed.selectedPattern)
  ) {
    throw new Error("The selected email pattern is absent from supporting evidence.");
  }

  let domainConfidence = coerceConfidenceLevel(parsed.domainConfidence);
  let patternConfidence = coerceConfidenceLevel(parsed.patternConfidence);
  if (!selectedEmailDomain) {
    domainConfidence = "UNAVAILABLE";
  }
  if (!parsed.selectedPattern) {
    patternConfidence = "UNAVAILABLE";
  }
  if (parsed.conflictingSourceCount > 0) {
    domainConfidence = domainConfidence === "HIGH" ? "MEDIUM" : domainConfidence;
    patternConfidence = patternConfidence === "HIGH" ? "MEDIUM" : patternConfidence;
  }

  return {
    selectedEmailDomain,
    selectedPattern: parsed.selectedPattern,
    domainConfidence,
    patternConfidence,
    supportingSources,
    conflictingSourceCount: parsed.conflictingSourceCount,
    decisionCode: parsed.decisionCode
  };
}

/**
 * Convert a validated discovery result into the evidence bundle the deterministic
 * selector consumes. Each row yields a domain-evidence entry and (when a pattern
 * is known) a pattern-evidence entry.
 */
export function discoveryResultToEvidenceBundle(
  result: EmailFormatDiscoveryResult,
  options: { now?: () => Date } = {}
): EmailEvidenceBundle {
  const observedAtIso = (options.now ?? (() => new Date()))().toISOString();
  const domainEvidence: EmailDomainEvidence[] = [];
  const patternEvidence: EmailPatternEvidence[] = [];

  for (const item of result.supportingSources) {
    const internal = internalSourceType(item.sourceType);
    const confidence = rowConfidence(item.percentage, internal, Boolean(item.exampleEmail));
    if (item.claimedDomain) {
      domainEvidence.push({
        emailDomain: item.claimedDomain,
        sourceName: item.label,
        sourceUrl: item.url,
        sourceType: internal,
        observedPattern: item.claimedPattern,
        percentage: item.percentage,
        confidence,
        observedAt: observedAtIso
      });
    }
    if (item.claimedPattern) {
      patternEvidence.push({
        pattern: item.claimedPattern,
        emailDomain: item.claimedDomain,
        percentage: item.percentage,
        sourceName: item.label,
        sourceUrl: item.url,
        sourceType: internal,
        confidence,
        observedAt: observedAtIso
      });
    }
  }

  return {
    domainEvidence,
    patternEvidence,
    decision: {
      decisionCode: result.decisionCode,
      supportingSourceCount: result.supportingSources.length,
      conflictingSourceCount: result.conflictingSourceCount
    }
  };
}

export function isOpenAIEmailFormatDiscoveryConfigured(): boolean {
  return (
    env.PROSPECT_EMAIL_DISCOVERY_PROVIDER === "openai_web_search" &&
    env.PROSPECT_EMAIL_FORMAT_WEB_SEARCH_ENABLED === true &&
    env.PROSPECT_AI_ENABLED === true &&
    Boolean(env.OPENAI_API_KEY)
  );
}

// ---------------------------------------------------------------------------
// OpenAI Responses API web-search caller.
// ---------------------------------------------------------------------------

export type WebSearchRequest = {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
};

export interface EmailFormatWebSearchCaller {
  readonly enabled: boolean;
  readonly model: string;
  /** Returns the parsed (but not yet validated) JSON object from the model. */
  search(request: WebSearchRequest): Promise<unknown>;
  getLastUsage?(): { inputTokens: number; outputTokens: number } | null;
}

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
};

function extractOutputText(response: OpenAIResponse): string {
  const direct = response.output_text?.trim();
  if (direct) {
    return direct;
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      const text = content.text?.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

/**
 * Concrete caller that hits the OpenAI Responses API with the built-in
 * `web_search` tool and strict structured output. This is the only place an
 * OpenAI HTTP request is made for email-format discovery — never inside a
 * resolver, never via Chat Completions.
 */
export class OpenAIWebSearchCaller implements EmailFormatWebSearchCaller {
  readonly model: string;
  private readonly apiKey?: string;
  private readonly reasoningEffort: string;
  private readonly enabledOverride?: boolean;
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;

  constructor(options?: { apiKey?: string; model?: string; reasoningEffort?: string; enabled?: boolean }) {
    this.apiKey = options?.apiKey ?? env.OPENAI_API_KEY;
    this.model = options?.model ?? env.PROSPECT_AI_MODEL ?? DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL;
    this.reasoningEffort = options?.reasoningEffort ?? env.PROSPECT_AI_REASONING_EFFORT ?? "low";
    this.enabledOverride = options?.enabled;
  }

  get enabled(): boolean {
    if (this.enabledOverride !== undefined) {
      return this.enabledOverride && Boolean(this.apiKey);
    }
    return Boolean(env.PROSPECT_AI_ENABLED && this.apiKey);
  }

  getLastUsage() {
    return this.lastUsage;
  }

  async search(request: WebSearchRequest): Promise<unknown> {
    if (!this.enabled) {
      throw new Error("Prospect AI is disabled or OPENAI_API_KEY is missing.");
    }
    this.lastUsage = null;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: request.instructions,
        input: request.input,
        tools: [{ type: "web_search" }],
        max_output_tokens: request.maxOutputTokens ?? EMAIL_FORMAT_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema
          }
        }
      })
    });

    const payload = (await response.json()) as OpenAIResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Email-format web search failed.");
    }

    if (
      typeof payload.usage?.input_tokens === "number" &&
      typeof payload.usage?.output_tokens === "number"
    ) {
      this.lastUsage = {
        inputTokens: payload.usage.input_tokens,
        outputTokens: payload.usage.output_tokens
      };
    }

    const text = extractOutputText(payload);
    if (!text) {
      throw new Error("Email-format web search returned an empty result.");
    }
    return JSON.parse(text) as unknown;
  }
}

// ---------------------------------------------------------------------------
// Evidence provider.
// ---------------------------------------------------------------------------

/**
 * EmailEvidenceProvider backed by GPT web search. Runs once per company (and at
 * most once per search via the shared `email_pattern` AI budget). A pasted
 * source URL short-circuits it so the manual parser/ranker handles that path.
 */
export class OpenAIEmailFormatDiscoveryService implements EmailEvidenceProvider {
  private readonly caller: EmailFormatWebSearchCaller | null;
  private readonly now: () => Date;

  constructor(options: { caller?: EmailFormatWebSearchCaller | null; now?: () => Date } = {}) {
    this.caller = options.caller ?? null;
    this.now = options.now ?? (() => new Date());
  }

  async findEvidence(input: EmailEvidenceProviderInput): Promise<EmailEvidenceBundle> {
    // Pasted source URL → defer to the deterministic parser + ranker.
    if (input.sourceUrl) {
      return {};
    }
    if (!isOpenAIEmailFormatDiscoveryConfigured()) {
      return {};
    }

    const caller = this.caller ?? new OpenAIWebSearchCaller();
    if (!caller.enabled) {
      return {};
    }

    // One AI call per company: the web search consumes the shared email_pattern
    // budget so the deterministic selector — not a second model call — chooses.
    const budget = input.budget;
    if (budget && !budget.canCall("email_pattern")) {
      return {};
    }
    budget?.record("email_pattern");

    const websiteDomain = normalizeDomain(input.officialWebsiteDomain);
    const compactInput = JSON.stringify(
      buildEmailFormatDiscoveryInput({
        companyName: input.companyName,
        websiteDomain
      })
    );

    let result: EmailFormatDiscoveryResult | null = null;
    let lastError: unknown = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let hasUsage = false;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const raw = await caller.search({
          instructions:
            attempt === 0
              ? OPENAI_EMAIL_FORMAT_INSTRUCTIONS
              : `${OPENAI_EMAIL_FORMAT_INSTRUCTIONS}\nThe previous response was invalid. Return corrected JSON only.`,
          input: compactInput,
          schemaName: "email_format_discovery",
          jsonSchema: OPENAI_EMAIL_FORMAT_JSON_SCHEMA as unknown as Record<string, unknown>,
          maxOutputTokens: EMAIL_FORMAT_MAX_OUTPUT_TOKENS
        });
        const usage = caller.getLastUsage?.();
        if (usage) {
          hasUsage = true;
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
        }
        try {
          result = validateDiscoveryResult(raw);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!result) {
        throw lastError ?? new Error("Email-format web search returned invalid JSON.");
      }
    } catch (error) {
      this.log({
        operation: "web_search_resolution",
        model: caller.model,
        sourceCount: 0,
        cacheHit: false,
        aiUsed: true,
        decisionCode: "INSUFFICIENT_EVIDENCE",
        ...(hasUsage ? { inputTokens, outputTokens } : {})
      });
      console.warn(
        "[prospect-email-format-discovery] web search failed",
        error instanceof Error ? error.message : error
      );
      return {};
    }

    const bundle = discoveryResultToEvidenceBundle(result, { now: this.now });
    this.log({
      operation: "web_search_resolution",
      model: caller.model,
      sourceCount: result.supportingSources.length,
      cacheHit: false,
      aiUsed: true,
      decisionCode: result.decisionCode,
      ...(hasUsage ? { inputTokens, outputTokens } : {})
    });
    return bundle;
  }

  // Safe telemetry only — never the API key, prompt, raw page content, tokens,
  // generated people, or personal emails.
  private log(entry: {
    operation: "web_search_resolution";
    model: string;
    sourceCount: number;
    cacheHit: boolean;
    aiUsed: boolean;
    decisionCode: EmailFormatDecisionCode;
    inputTokens?: number;
    outputTokens?: number;
  }) {
    console.info("[email-format-ai] Resolution completed.", entry);
  }
}
