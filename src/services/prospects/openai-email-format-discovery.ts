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

import { env } from "@/lib/env";
import {
  CONFIDENCE_LEVELS,
  EMAIL_PATTERNS,
  type ConfidenceLevel,
  type EmailPattern,
  coerceConfidenceLevel,
  isEmailPattern
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
import { normalizePublicEmailPattern } from "@/services/prospects/email-format-discovery-service";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

// The discovery model defaults to GPT-5.5; override with PROSPECT_AI_MODEL.
export const DEFAULT_PROSPECT_EMAIL_FORMAT_MODEL = "gpt-5.5";

const MAX_QUOTE_LENGTH = 280;
const MAX_EVIDENCE_ROWS = 12;

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
  sourceName: string;
  sourceUrl: string | null;
  sourceType: DiscoverySourceType;
  patternRaw: string | null;
  normalizedPattern: EmailPattern | null;
  exampleEmail: string | null;
  emailDomain: string | null;
  percentage: number | null;
  quote: string | null;
};

export type EmailFormatDiscoveryResult = {
  companyName: string;
  websiteDomain: string | null;
  selectedEmailDomain: string | null;
  selectedPattern: EmailPattern | null;
  confidence: ConfidenceLevel;
  reasonSummary: string;
  evidence: EmailFormatEvidenceItem[];
};

// Strict JSON schema for the Responses API structured output. Every property is
// required and nullable via type unions (the strict-mode contract), mirroring
// the existing prospect AI schemas.
export const OPENAI_EMAIL_FORMAT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "companyName",
    "websiteDomain",
    "selectedEmailDomain",
    "selectedPattern",
    "confidence",
    "reasonSummary",
    "evidence"
  ],
  properties: {
    companyName: { type: "string" },
    websiteDomain: { type: ["string", "null"] },
    selectedEmailDomain: { type: ["string", "null"] },
    selectedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
    reasonSummary: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sourceName",
          "sourceUrl",
          "sourceType",
          "patternRaw",
          "normalizedPattern",
          "exampleEmail",
          "emailDomain",
          "percentage",
          "quote"
        ],
        properties: {
          sourceName: { type: "string" },
          sourceUrl: { type: ["string", "null"] },
          sourceType: { type: "string", enum: [...DISCOVERY_SOURCE_TYPES] },
          patternRaw: { type: ["string", "null"] },
          normalizedPattern: { type: ["string", "null"], enum: [...EMAIL_PATTERNS, null] },
          exampleEmail: { type: ["string", "null"] },
          emailDomain: { type: ["string", "null"] },
          percentage: { type: ["number", "null"] },
          quote: { type: ["string", "null"] }
        }
      }
    }
  }
} as const;

export const OPENAI_EMAIL_FORMAT_INSTRUCTIONS = [
  "You are finding a company's public work email format.",
  "Rules:",
  "1. Search the web for public email-format evidence.",
  "2. Prefer public email-format pages such as RocketReach/Hunter-style format pages.",
  "3. Extract the email domain from example work emails.",
  "4. Do not assume the website domain is the email domain.",
  "5. Website domain and employee email domain can differ (e.g. website appliedmaterials.com, email domain amat.com).",
  "6. Select the highest-confidence pattern only when evidence supports it.",
  "7. Never fabricate a percentage.",
  "8. Never fabricate a source URL.",
  "9. Never mark inferred emails as verified.",
  "10. If evidence is weak, return LOW or UNAVAILABLE.",
  "11. Do not collect phone numbers.",
  "12. Do not collect personal email domains.",
  "13. Do not return Gmail/Yahoo/Outlook/iCloud personal domains.",
  "14. selectedPattern must be one of: " + EMAIL_PATTERNS.join(", ") + ".",
  "15. Return structured JSON only."
].join("\n");

export type EmailFormatDiscoveryInput = {
  companyName: string;
  websiteDomain: string | null;
  knownLinkedinUrl: string | null;
  targetRoles: string[];
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
    companyName: input.companyName,
    websiteDomain: input.websiteDomain,
    knownLinkedinUrl: input.knownLinkedinUrl,
    targetRoles: input.targetRoles,
    suggestedQueries: buildEmailFormatDiscoveryQueries(input.companyName, input.websiteDomain),
    note: "websiteDomain may differ from the employee email domain — extract the email domain from example work emails."
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

export function normalizeDiscoveryPattern(item: {
  normalizedPattern?: unknown;
  patternRaw?: unknown;
}): EmailPattern | null {
  if (isEmailPattern(item.normalizedPattern)) {
    return item.normalizedPattern;
  }
  if (typeof item.patternRaw === "string" && item.patternRaw.trim()) {
    return normalizePublicEmailPattern(item.patternRaw);
  }
  return null;
}

function clampPercentage(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0 || value > 100) {
    return null;
  }
  return value;
}

function truncateQuote(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > MAX_QUOTE_LENGTH ? `${trimmed.slice(0, MAX_QUOTE_LENGTH)}…` : trimmed;
}

function rowConfidence(
  percentage: number | null,
  quote: string | null,
  sourceType: EmailEvidenceSourceType,
  hasUrl: boolean
): ConfidenceLevel {
  if (percentage !== null && percentage >= 75) {
    return "HIGH";
  }
  if (quote && /\b(most common|highest percentage|most used|primary)\b/i.test(quote)) {
    return "HIGH";
  }
  if (percentage !== null && percentage >= 35) {
    return "MEDIUM";
  }
  if ((sourceType === "hunter" || sourceType === "public_format_page") && hasUrl) {
    return "MEDIUM";
  }
  return "LOW";
}

type CleanEvidenceRow = {
  item: EmailFormatEvidenceItem;
  emailDomain: string | null;
  pattern: EmailPattern | null;
  sourceType: EmailEvidenceSourceType;
  confidence: ConfidenceLevel;
};

function cleanEvidenceItem(raw: unknown): CleanEvidenceRow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;

  const sourceType: DiscoverySourceType = DISCOVERY_SOURCE_TYPES.includes(row.sourceType as DiscoverySourceType)
    ? (row.sourceType as DiscoverySourceType)
    : "other";
  const sourceUrl = typeof row.sourceUrl === "string" && /^https?:\/\//i.test(row.sourceUrl.trim())
    ? row.sourceUrl.trim()
    : null;
  const exampleEmail = typeof row.exampleEmail === "string" ? row.exampleEmail.trim().toLowerCase() : null;

  // Rule 3/6: trust the example work email's domain over a stated emailDomain.
  const exampleDomain = emailDomainOf(exampleEmail);
  const statedDomain = normalizeDomain(typeof row.emailDomain === "string" ? row.emailDomain : null);
  const emailDomain = exampleDomain ?? statedDomain;
  // Rule 12/13: drop personal/aggregator domains entirely.
  const allowedDomain = emailDomain && isAllowedBusinessEmailDomain(emailDomain) ? emailDomain : null;

  const pattern = normalizeDiscoveryPattern({
    normalizedPattern: row.normalizedPattern,
    patternRaw: row.patternRaw
  });

  // Keep a row only if it contributes a usable domain or pattern.
  if (!allowedDomain && !pattern) {
    return null;
  }

  const percentage = clampPercentage(row.percentage);
  const quote = truncateQuote(row.quote);
  const internal = internalSourceType(sourceType);
  const sourceName =
    typeof row.sourceName === "string" && row.sourceName.trim()
      ? row.sourceName.trim().slice(0, 120)
      : "Public email-format source";

  return {
    item: {
      sourceName,
      sourceUrl,
      sourceType,
      patternRaw: typeof row.patternRaw === "string" ? row.patternRaw.trim().slice(0, 80) || null : null,
      normalizedPattern: pattern,
      exampleEmail: exampleDomain ? exampleEmail : null,
      emailDomain: allowedDomain,
      percentage,
      quote
    },
    emailDomain: allowedDomain,
    pattern,
    sourceType: internal,
    confidence: rowConfidence(percentage, quote, internal, Boolean(sourceUrl))
  };
}

/**
 * Validate and clean a raw model response into a trustworthy discovery result.
 * The backend never trusts the model directly: unsupported patterns, personal
 * domains, and selections that are not actually present in the evidence are all
 * rejected, and HIGH confidence requires a sourced, quantified row.
 */
export function validateDiscoveryResult(
  raw: unknown,
  options: { companyName?: string; websiteDomain?: string | null } = {}
): EmailFormatDiscoveryResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const companyName =
    typeof obj.companyName === "string" && obj.companyName.trim()
      ? obj.companyName.trim()
      : options.companyName ?? "";
  const websiteDomain = normalizeDomain(
    typeof obj.websiteDomain === "string" ? obj.websiteDomain : options.websiteDomain ?? null
  );

  const rawEvidence = Array.isArray(obj.evidence) ? obj.evidence : [];
  const cleaned = rawEvidence
    .map(cleanEvidenceItem)
    .filter((row): row is CleanEvidenceRow => Boolean(row))
    .slice(0, MAX_EVIDENCE_ROWS);

  const evidenceDomains = new Set(cleaned.map((row) => row.emailDomain).filter((d): d is string => Boolean(d)));
  const evidencePatterns = new Set(cleaned.map((row) => row.pattern).filter((p): p is EmailPattern => Boolean(p)));

  // Validate the model's proposed selection against the evidence.
  let selectedEmailDomain = normalizeDomain(
    typeof obj.selectedEmailDomain === "string" ? obj.selectedEmailDomain : null
  );
  if (!selectedEmailDomain || !isAllowedBusinessEmailDomain(selectedEmailDomain) || !evidenceDomains.has(selectedEmailDomain)) {
    selectedEmailDomain = null;
  }

  let selectedPattern = isEmailPattern(obj.selectedPattern) ? obj.selectedPattern : null;
  if (selectedPattern && !evidencePatterns.has(selectedPattern)) {
    selectedPattern = null;
  }

  let confidence = coerceConfidenceLevel(obj.confidence);
  if (!selectedEmailDomain || !selectedPattern) {
    // Without a validated domain + pattern there is nothing to be confident in.
    confidence = cleaned.length > 0 ? "LOW" : "UNAVAILABLE";
  } else if (confidence === "HIGH") {
    // Rule 5: HIGH needs at least one sourced row that also carries a percentage
    // or an example email for the selected domain/pattern.
    const strong = cleaned.some(
      (row) =>
        row.emailDomain === selectedEmailDomain &&
        Boolean(row.item.sourceUrl) &&
        (row.item.percentage !== null || Boolean(row.item.exampleEmail))
    );
    if (!strong) {
      confidence = "MEDIUM";
    }
  }

  const reasonSummary =
    typeof obj.reasonSummary === "string" && obj.reasonSummary.trim()
      ? obj.reasonSummary.trim().slice(0, 400)
      : selectedEmailDomain && selectedPattern
        ? `Public evidence indicates ${selectedPattern} on ${selectedEmailDomain}.`
        : "No conclusive public email-format evidence was found.";

  return {
    companyName,
    websiteDomain,
    selectedEmailDomain,
    selectedPattern,
    confidence,
    reasonSummary,
    evidence: cleaned.map((row) => row.item)
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

  for (const item of result.evidence) {
    const internal = internalSourceType(item.sourceType);
    const confidence = rowConfidence(item.percentage, item.quote, internal, Boolean(item.sourceUrl));
    if (item.emailDomain) {
      domainEvidence.push({
        emailDomain: item.emailDomain,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        sourceType: internal,
        observedPattern: item.normalizedPattern,
        percentage: item.percentage,
        confidence,
        observedAt: observedAtIso
      });
    }
    if (item.normalizedPattern) {
      patternEvidence.push({
        pattern: item.normalizedPattern,
        emailDomain: item.emailDomain,
        percentage: item.percentage,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        sourceType: internal,
        confidence,
        observedAt: observedAtIso
      });
    }
  }

  return { domainEvidence, patternEvidence, reasonSummary: result.reasonSummary };
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
}

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
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

  async search(request: WebSearchRequest): Promise<unknown> {
    if (!this.enabled) {
      throw new Error("Prospect AI is disabled or OPENAI_API_KEY is missing.");
    }

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
        max_output_tokens: request.maxOutputTokens ?? 2000,
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

    const startedAt = Date.now();
    const websiteDomain = normalizeDomain(input.officialWebsiteDomain);

    let result: EmailFormatDiscoveryResult;
    try {
      const raw = await caller.search({
        instructions: OPENAI_EMAIL_FORMAT_INSTRUCTIONS,
        input: JSON.stringify(
          buildEmailFormatDiscoveryInput({
            companyName: input.companyName,
            websiteDomain,
            knownLinkedinUrl: input.knownLinkedinUrl ?? null,
            targetRoles: input.targetRoles ?? []
          })
        ),
        schemaName: "email_format_discovery",
        jsonSchema: OPENAI_EMAIL_FORMAT_JSON_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: 2000
      });
      result = validateDiscoveryResult(raw, { companyName: input.companyName, websiteDomain });
    } catch (error) {
      this.log({
        companyId: input.companyId ?? null,
        companyName: input.companyName,
        model: caller.model,
        webSearchUsed: false,
        evidenceCount: 0,
        selectedEmailDomain: null,
        selectedPattern: null,
        confidence: "UNAVAILABLE",
        latencyMs: Date.now() - startedAt,
        success: false
      });
      console.warn(
        "[prospect-email-format-discovery] web search failed",
        error instanceof Error ? error.message : error
      );
      return {};
    }

    const bundle = discoveryResultToEvidenceBundle(result, { now: this.now });
    this.log({
      companyId: input.companyId ?? null,
      companyName: input.companyName,
      model: caller.model,
      webSearchUsed: true,
      evidenceCount: result.evidence.length,
      selectedEmailDomain: result.selectedEmailDomain,
      selectedPattern: result.selectedPattern,
      confidence: result.confidence,
      latencyMs: Date.now() - startedAt,
      success: true
    });
    return bundle;
  }

  // Safe telemetry only — never the API key, prompt, raw page content, tokens,
  // generated people, or personal emails.
  private log(entry: {
    companyId: string | null;
    companyName: string;
    model: string;
    webSearchUsed: boolean;
    evidenceCount: number;
    selectedEmailDomain: string | null;
    selectedPattern: EmailPattern | null;
    confidence: ConfidenceLevel;
    latencyMs: number;
    success: boolean;
  }) {
    console.info("[prospect-email-format-discovery]", JSON.stringify(entry));
  }
}
