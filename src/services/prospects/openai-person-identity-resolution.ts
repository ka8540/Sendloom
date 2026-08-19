// AI web-search resolution for INCOMPLETE person identities.
//
// This is a strict fallback, never a default. `parsePersonName` resolves the
// overwhelming majority of names deterministically; only a person we genuinely
// cannot address — "Jared C.", "Jared", "J. Cho" — reaches this module, and only
// while a per-search budget allows it.
//
// It reuses the same infrastructure as the company email-format discovery path:
// GPT via the OpenAI Responses API with the built-in `web_search` tool and a
// strict structured-output schema. It never uses Chat Completions, Hunter, or
// any scraping service, and it never reads an authenticated LinkedIn page — only
// public professional evidence.
//
// The acceptance bar is deliberately punishing. A surname is adopted ONLY when
// the model reports HIGH confidence, asserts both an identity and an employer
// match, cites at least one public source, and the returned name is
// structurally complete AND consistent with what we already knew about the
// person. Anything else — LOW confidence, conflict, no evidence, a timeout, a
// malformed payload, a missing API key — returns UNAVAILABLE, and UNAVAILABLE
// means the person keeps no email at all. A missing address is always
// preferable to a confidently wrong one.

import { z } from "zod";

import { env } from "@/lib/env";
import { type AiCallBudget } from "@/services/prospects/prospect-ai";
import {
  type PersonIdentityStatus,
  parsePersonName
} from "@/services/prospects/prospect-person-name";
import { stripDiacritics } from "@/services/prospects/prospect-normalization";

export const DEFAULT_IDENTITY_RESOLUTION_MODEL = "gpt-5.5";
export const IDENTITY_RESOLUTION_MAX_OUTPUT_TOKENS = 900;
export const IDENTITY_RESOLUTION_TIMEOUT_MS = 20_000;
export const IDENTITY_RESOLUTION_MAX_SOURCES = 4;

/** The public professional context we are willing to search on. */
export type PersonIdentityResolutionInput = {
  /** The person's stored display name, exactly as Discover holds it. */
  displayName: string;
  /** The given name we already established, when there is one. */
  knownFirstName: string | null;
  /** The given-name initial we already established, when there is one. */
  knownFirstInitial: string | null;
  companyName: string;
  companyDomain: string | null;
  currentTitle: string | null;
  /** Professional location only (city/state/country). Never an address. */
  location: string | null;
  linkedinUrl: string | null;
};

export type PersonIdentityResolutionOutcome =
  | "RESOLVED"
  | "UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "BUDGET_EXHAUSTED";

export type PersonIdentityResolution = {
  outcome: PersonIdentityResolutionOutcome;
  firstName: string | null;
  lastName: string | null;
  /** Short, PII-free explanation. Safe to log. */
  reason: string;
};

const UNRESOLVED = (reason: string): PersonIdentityResolution => ({
  outcome: "UNAVAILABLE",
  firstName: null,
  lastName: null,
  reason
});

// ---------------------------------------------------------------------------
// Structured output contract
// ---------------------------------------------------------------------------

const RESOLUTION_CONFIDENCE = ["HIGH", "LOW", "UNAVAILABLE"] as const;

export const OPENAI_PERSON_IDENTITY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "resolvedFirstName",
    "resolvedLastName",
    "confidence",
    "identityMatched",
    "companyMatched",
    "sources",
    "reason"
  ],
  properties: {
    resolvedFirstName: { type: ["string", "null"] },
    resolvedLastName: { type: ["string", "null"] },
    confidence: { type: "string", enum: [...RESOLUTION_CONFIDENCE] },
    identityMatched: { type: "boolean" },
    companyMatched: { type: "boolean" },
    sources: {
      type: "array",
      maxItems: IDENTITY_RESOLUTION_MAX_SOURCES,
      items: { type: "string" }
    },
    reason: { type: "string" }
  }
} as const;

const resolutionSchema = z
  .object({
    resolvedFirstName: z.string().nullable(),
    resolvedLastName: z.string().nullable(),
    confidence: z.enum(RESOLUTION_CONFIDENCE),
    identityMatched: z.boolean(),
    companyMatched: z.boolean(),
    sources: z.array(z.string()).max(IDENTITY_RESOLUTION_MAX_SOURCES),
    reason: z.string().max(400)
  })
  .strict();

export const OPENAI_PERSON_IDENTITY_INSTRUCTIONS = [
  "You establish the complete public professional name of ONE specific person whose stored name is incomplete.",
  "Rules:",
  "1. The person is identified by their employer, role, professional location, and public profile URL.",
  "2. Search only public professional sources.",
  "3. Return a name ONLY when the evidence clearly describes the SAME person: same employer, compatible role, compatible public profile.",
  "4. A shared first name, shared last initial, or shared large employer is NOT identification. Reject it.",
  "5. Never invent or guess a surname.",
  "6. Never derive a surname from a profile URL slug.",
  "7. If public sources disagree about the person's name, return confidence UNAVAILABLE.",
  "8. If you cannot find the person, return confidence UNAVAILABLE with null names.",
  "9. Use HIGH confidence only for an unambiguous identity match backed by cited public sources.",
  "10. Never search for or return a home address, personal phone number, family information, private social profiles, date of birth, or any other sensitive personal information.",
  "11. Never return an email address.",
  "12. Cite only public URLs you actually consulted.",
  "13. Keep `reason` to one short sentence with no personal details.",
  "14. Return strict JSON only."
].join("\n");

/** Compact, public-professional-only search context handed to the model. */
export function buildIdentityResolutionInput(
  input: PersonIdentityResolutionInput
): Record<string, unknown> {
  return {
    storedName: input.displayName,
    knownGivenName: input.knownFirstName,
    employer: input.companyName,
    employerDomain: input.companyDomain,
    role: input.currentTitle,
    professionalLocation: input.location,
    publicProfileUrl: input.linkedinUrl,
    task: "Determine this person's complete public professional first and last name."
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

function comparableName(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Decide whether a model answer may become a person's canonical identity.
 *
 * Every check here exists to stop a plausible-sounding hallucination from
 * becoming a real email address, so they are all conjunctive and all failures
 * collapse to the same safe UNAVAILABLE.
 */
export function acceptResolution(
  raw: unknown,
  input: PersonIdentityResolutionInput
): PersonIdentityResolution {
  const parsed = resolutionSchema.safeParse(raw);
  if (!parsed.success) {
    return UNRESOLVED("The identity provider response did not match the required schema.");
  }
  const result = parsed.data;

  if (result.confidence !== "HIGH") {
    return UNRESOLVED("Public evidence was not conclusive enough to establish the name.");
  }
  if (!result.identityMatched || !result.companyMatched) {
    return UNRESOLVED("No public source matched both the person and their employer.");
  }
  if (result.sources.length === 0) {
    return UNRESOLVED("The identity answer cited no public source.");
  }
  // Every citation must be a real absolute http(s) URL, or the "evidence" is
  // itself fabricated.
  const validSources = result.sources.filter((source) => {
    try {
      const url = new URL(source);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
  if (validSources.length === 0) {
    return UNRESOLVED("The identity answer cited no usable public source URL.");
  }

  if (!result.resolvedFirstName || !result.resolvedLastName) {
    return UNRESOLVED("The identity answer did not contain a complete name.");
  }

  // The returned name must itself survive canonical parsing — the resolver is
  // not a way to smuggle "Cho M.B.A." or an emoji back into the pipeline.
  const identity = parsePersonName({
    firstName: result.resolvedFirstName,
    lastName: result.resolvedLastName
  });
  if (identity.status !== "COMPLETE" || !identity.firstName || !identity.lastName) {
    return UNRESOLVED("The resolved name was not a complete, usable identity.");
  }

  // Consistency with what we already knew. A resolver that "corrects" Jared to
  // Michael has found a different person, not this one.
  const resolvedFirst = comparableName(identity.firstName);
  const knownFirst = input.knownFirstName ? comparableName(input.knownFirstName) : null;
  if (knownFirst && knownFirst !== resolvedFirst) {
    return UNRESOLVED("The resolved given name contradicts the stored identity.");
  }
  const knownInitial = input.knownFirstInitial ? comparableName(input.knownFirstInitial) : null;
  if (!knownFirst && knownInitial && resolvedFirst[0] !== knownInitial[0]) {
    return UNRESOLVED("The resolved given name contradicts the stored initial.");
  }

  // A "resolved" surname that is itself just an initial resolves nothing.
  if (comparableName(identity.lastName).length < 2) {
    return UNRESOLVED("The resolved family name was not a complete surname.");
  }

  return {
    outcome: "RESOLVED",
    firstName: identity.firstName,
    lastName: identity.lastName,
    reason: "A complete name was established from matching public professional sources."
  };
}

// ---------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------

export type IdentitySearchRequest = {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
};

/** Injectable seam so the service is testable without the network. */
export interface PersonIdentitySearchCaller {
  readonly enabled: boolean;
  readonly model: string;
  search(request: IdentitySearchRequest): Promise<unknown>;
}

type OpenAIResponse = {
  status?: string;
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

export function isPersonIdentityResolutionConfigured(): boolean {
  return (
    env.PROSPECT_IDENTITY_RESOLUTION_ENABLED === true &&
    env.PROSPECT_AI_ENABLED === true &&
    Boolean(env.OPENAI_API_KEY)
  );
}

/**
 * The only place this module makes an HTTP request. Mirrors the email-format
 * caller: Responses API, required `web_search` tool, strict JSON schema — plus a
 * hard timeout, because a hung identity lookup must never stall a search.
 */
export class OpenAIPersonIdentitySearchCaller implements PersonIdentitySearchCaller {
  readonly model: string;
  private readonly apiKey?: string;
  private readonly reasoningEffort: string;
  private readonly timeoutMs: number;
  private readonly enabledOverride?: boolean;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    reasoningEffort?: string;
    timeoutMs?: number;
    enabled?: boolean;
  }) {
    this.apiKey = options?.apiKey ?? env.OPENAI_API_KEY;
    this.model = options?.model ?? env.PROSPECT_AI_MODEL ?? DEFAULT_IDENTITY_RESOLUTION_MODEL;
    this.reasoningEffort = options?.reasoningEffort ?? env.PROSPECT_AI_REASONING_EFFORT ?? "low";
    this.timeoutMs = options?.timeoutMs ?? IDENTITY_RESOLUTION_TIMEOUT_MS;
    this.enabledOverride = options?.enabled;
  }

  get enabled(): boolean {
    if (this.enabledOverride !== undefined) {
      return this.enabledOverride && Boolean(this.apiKey);
    }
    return Boolean(env.PROSPECT_AI_ENABLED && this.apiKey);
  }

  async search(request: IdentitySearchRequest): Promise<unknown> {
    if (!this.enabled) {
      throw new Error("Prospect AI is disabled or OPENAI_API_KEY is missing.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
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
          // Identity resolution is worthless without evidence, so the search is
          // mandatory rather than `auto`.
          tool_choice: "required",
          max_output_tokens: request.maxOutputTokens ?? IDENTITY_RESOLUTION_MAX_OUTPUT_TOKENS,
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
        // Deliberately generic: a provider message can echo the prompt back.
        throw new Error("The identity provider rejected the request.");
      }
      if (payload.status === "incomplete") {
        throw new Error("The identity provider response was incomplete.");
      }
      const text = extractOutputText(payload);
      if (!text) {
        throw new Error("The identity provider returned an empty result.");
      }
      return JSON.parse(text) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** The narrow port the ingestion pipeline and the repair backfill depend on. */
export interface PersonIdentityResolverPort {
  resolve(
    input: PersonIdentityResolutionInput,
    options?: { budget?: AiCallBudget }
  ): Promise<PersonIdentityResolution>;
}

export class OpenAIPersonIdentityResolver implements PersonIdentityResolverPort {
  private readonly caller: PersonIdentitySearchCaller | null;

  constructor(options: { caller?: PersonIdentitySearchCaller | null } = {}) {
    this.caller = options.caller ?? null;
  }

  async resolve(
    input: PersonIdentityResolutionInput,
    options: { budget?: AiCallBudget } = {}
  ): Promise<PersonIdentityResolution> {
    if (!isPersonIdentityResolutionConfigured()) {
      return {
        outcome: "NOT_CONFIGURED",
        firstName: null,
        lastName: null,
        reason: "Ambiguous-name resolution is not configured."
      };
    }

    // Without an employer we cannot establish that a search result is the same
    // person, and the acceptance rules would reject anything we found anyway.
    if (!input.companyName.trim()) {
      return UNRESOLVED("There is no employer context to identify this person by.");
    }

    const caller = this.caller ?? new OpenAIPersonIdentitySearchCaller();
    if (!caller.enabled) {
      return {
        outcome: "NOT_CONFIGURED",
        firstName: null,
        lastName: null,
        reason: "Ambiguous-name resolution is not configured."
      };
    }

    const budget = options.budget;
    if (budget && !budget.canCall("person_identity")) {
      return {
        outcome: "BUDGET_EXHAUSTED",
        firstName: null,
        lastName: null,
        reason: "The ambiguous-name resolution budget is exhausted for this search."
      };
    }
    budget?.record("person_identity");

    let raw: unknown;
    try {
      raw = await caller.search({
        instructions: OPENAI_PERSON_IDENTITY_INSTRUCTIONS,
        input: JSON.stringify(buildIdentityResolutionInput(input)),
        schemaName: "person_identity_resolution",
        jsonSchema: OPENAI_PERSON_IDENTITY_JSON_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: IDENTITY_RESOLUTION_MAX_OUTPUT_TOKENS
      });
    } catch {
      // Network error, timeout, auth failure, malformed JSON — all identical
      // from here: we did not establish a name, so we do not have one.
      return UNRESOLVED("The identity provider could not be reached or returned an unusable response.");
    }

    const resolution = acceptResolution(raw, input);
    logIdentityResolution({
      model: caller.model,
      outcome: resolution.outcome,
      accepted: resolution.outcome === "RESOLVED"
    });
    return resolution;
  }
}

// Counts and outcomes only — never a name, profile URL, employer, prompt, raw
// model output, or API key.
function logIdentityResolution(entry: {
  model: string;
  outcome: PersonIdentityResolutionOutcome;
  accepted: boolean;
}): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  console.info("[discover-identity-resolution]", JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * The shape the resolver needs from an ingested profile. Structurally satisfied
 * by NormalizedProfile, kept generic so this module has no dependency on the
 * provider-ingestion layer.
 */
export type ResolvableProfile = {
  firstName: string;
  lastName: string;
  fullName: string;
  identityStatus: PersonIdentityStatus;
  currentTitle: string | null;
  location: string | null;
  linkedinUrl: string;
};

/**
 * Complete the identities that deterministic parsing could not, leaving every
 * other profile untouched.
 *
 * Three properties matter here:
 *  - a COMPLETE identity never reaches the model, so a clean search costs $0;
 *  - calls run one at a time and stop the moment the per-search budget is spent,
 *    so a page full of malformed names cannot fan out;
 *  - a profile whose resolution fails is returned unchanged and still AMBIGUOUS
 *    or INCOMPLETE, which downstream turns into no email rather than a guess.
 */
export async function resolveIncompleteIdentities<T extends ResolvableProfile>(
  profiles: T[],
  context: {
    companyName: string;
    companyDomain: string | null;
    resolver: PersonIdentityResolverPort;
    budget?: AiCallBudget;
  }
): Promise<T[]> {
  const needsResolution = profiles.some(
    (profile) => profile.identityStatus === "AMBIGUOUS" || profile.identityStatus === "INCOMPLETE"
  );
  if (!needsResolution || !isPersonIdentityResolutionConfigured()) {
    return profiles;
  }

  const resolved: T[] = [];
  let budgetSpent = false;
  for (const profile of profiles) {
    const ambiguous = profile.identityStatus === "AMBIGUOUS" || profile.identityStatus === "INCOMPLETE";
    if (!ambiguous || budgetSpent) {
      resolved.push(profile);
      continue;
    }

    const identity = parsePersonName({
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.fullName
    });
    const resolution = await context.resolver.resolve(
      {
        displayName: profile.fullName,
        knownFirstName: identity.firstName,
        knownFirstInitial: identity.firstInitial,
        companyName: context.companyName,
        companyDomain: context.companyDomain,
        currentTitle: profile.currentTitle,
        location: profile.location,
        linkedinUrl: profile.linkedinUrl
      },
      { budget: context.budget }
    );

    if (resolution.outcome === "BUDGET_EXHAUSTED" || resolution.outcome === "NOT_CONFIGURED") {
      // Nothing later in this batch can succeed either; stop paying to find out.
      budgetSpent = true;
      resolved.push(profile);
      continue;
    }
    if (resolution.outcome !== "RESOLVED" || !resolution.firstName || !resolution.lastName) {
      resolved.push(profile);
      continue;
    }

    const corrected = parsePersonName({
      firstName: resolution.firstName,
      lastName: resolution.lastName
    });
    resolved.push({
      ...profile,
      firstName: corrected.firstName ?? profile.firstName,
      lastName: corrected.lastName ?? profile.lastName,
      fullName: corrected.fullName || profile.fullName,
      identityStatus: corrected.status
    });
  }

  return resolved;
}
