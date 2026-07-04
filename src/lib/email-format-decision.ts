export const EMAIL_FORMAT_DISCOVERY_VERSION = "structured-v2";

export const EMAIL_FORMAT_DECISION_CODES = [
  "SOURCE_MAJORITY",
  "EXACT_COMPANY_MATCH",
  "VERIFIED_EXAMPLE",
  "DOMAIN_CONSENSUS",
  "PATTERN_CONSENSUS",
  "INSUFFICIENT_EVIDENCE"
] as const;

export type EmailFormatDecisionCode = (typeof EMAIL_FORMAT_DECISION_CODES)[number];

export type EmailFormatDecisionMetadata = {
  version: typeof EMAIL_FORMAT_DISCOVERY_VERSION;
  decisionCode: EmailFormatDecisionCode;
  supportingSourceCount: number;
  conflictingSourceCount: number;
  cacheKey: string;
};

function normalizeIdentityPart(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/^www\./, "") ?? "";
}

export function buildEmailFormatCacheKey(input: {
  companyName: string;
  websiteDomain: string | null | undefined;
  emailDomain: string | null | undefined;
}) {
  return [
    EMAIL_FORMAT_DISCOVERY_VERSION,
    normalizeIdentityPart(input.companyName).replace(/[^a-z0-9]+/g, " ").trim(),
    normalizeIdentityPart(input.websiteDomain),
    normalizeIdentityPart(input.emailDomain)
  ].join("|");
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseEmailFormatDecisionMetadata(value: unknown): EmailFormatDecisionMetadata | null {
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const supportingSourceCount = nonNegativeInteger(parsed.supportingSourceCount);
    const conflictingSourceCount = nonNegativeInteger(parsed.conflictingSourceCount);
    if (
      parsed.version !== EMAIL_FORMAT_DISCOVERY_VERSION ||
      !EMAIL_FORMAT_DECISION_CODES.includes(parsed.decisionCode as EmailFormatDecisionCode) ||
      supportingSourceCount === null ||
      conflictingSourceCount === null ||
      typeof parsed.cacheKey !== "string"
    ) {
      return null;
    }

    return {
      version: EMAIL_FORMAT_DISCOVERY_VERSION,
      decisionCode: parsed.decisionCode as EmailFormatDecisionCode,
      supportingSourceCount,
      conflictingSourceCount,
      cacheKey: parsed.cacheKey
    };
  } catch {
    return null;
  }
}

export function serializeEmailFormatDecisionMetadata(metadata: EmailFormatDecisionMetadata) {
  return JSON.stringify(metadata);
}
