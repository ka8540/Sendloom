import {
  type ConfidenceLevel,
  type EmailCandidateStatus,
  type EmailPattern,
  isEmailPattern
} from "@/lib/prospect-enums";
import { isPersonalEmailDomain, normalizeDomain, normalizeNameForEmail } from "@/services/prospects/prospect-normalization";

export type GenerateEmailInput = {
  firstName: string;
  lastName: string;
  domain: string;
  pattern: string;
};

// Deterministically build an email local part from normalized name tokens.
// Returns null when the pattern needs a component the name does not provide.
function buildLocalPart(pattern: EmailPattern, first: string | null, last: string | null): string | null {
  const firstInitial = first ? first[0] : null;
  const lastInitial = last ? last[0] : null;

  switch (pattern) {
    case "first":
      return first;
    case "last":
      return last;
    case "firstlast":
      return first && last ? `${first}${last}` : null;
    case "first.last":
      return first && last ? `${first}.${last}` : null;
    case "first_last":
      return first && last ? `${first}_${last}` : null;
    case "flast":
      return firstInitial && last ? `${firstInitial}${last}` : null;
    case "f.last":
      return firstInitial && last ? `${firstInitial}.${last}` : null;
    case "f_last":
      return firstInitial && last ? `${firstInitial}_${last}` : null;
    case "firstl":
      return first && lastInitial ? `${first}${lastInitial}` : null;
    case "first.l":
      return first && lastInitial ? `${first}.${lastInitial}` : null;
    case "lastf":
      return last && firstInitial ? `${last}${firstInitial}` : null;
    case "last.first":
      return last && first ? `${last}.${first}` : null;
    default:
      return null;
  }
}

/**
 * Generate a single candidate email deterministically from a company-level
 * pattern. No AI is used here. Returns null when the name or domain cannot
 * safely produce a business address.
 *
 * Rules enforced:
 *  - names are Unicode-normalized to ascii, apostrophes/hyphens handled
 *  - professional suffixes removed (done by normalizeNameForEmail)
 *  - missing first/last (for the chosen pattern) yields null
 *  - personal mailbox domains are rejected
 */
export function generateEmail(input: GenerateEmailInput): string | null {
  if (!isEmailPattern(input.pattern)) {
    return null;
  }

  const domain = normalizeDomain(input.domain);
  if (!domain || isPersonalEmailDomain(domain)) {
    return null;
  }

  const { first, last } = normalizeNameForEmail(input.firstName ?? "", input.lastName ?? "");
  const localPart = buildLocalPart(input.pattern, first, last);
  if (!localPart) {
    return null;
  }

  return `${localPart}@${domain}`;
}

// Map a company pattern's confidence onto a per-person email candidate status.
const STATUS_BY_CONFIDENCE: Record<ConfidenceLevel, EmailCandidateStatus> = {
  HIGH: "INFERRED_HIGH",
  MEDIUM: "INFERRED_MEDIUM",
  LOW: "INFERRED_LOW",
  UNAVAILABLE: "UNAVAILABLE"
};

export type CandidateEmail = {
  email: string | null;
  status: EmailCandidateStatus;
  confidence: ConfidenceLevel;
};

/**
 * Resolve a person's candidate email from the company-level pattern. When the
 * pattern confidence is LOW, addresses are withheld (status UNAVAILABLE) unless
 * the caller explicitly allows low-confidence generation for local testing.
 *
 * Inferred emails are NEVER marked VERIFIED — that status is reserved for a
 * future verification step.
 */
export function resolveCandidateEmail(options: {
  firstName: string;
  lastName: string;
  domain: string | null | undefined;
  pattern: string | null | undefined;
  patternConfidence: ConfidenceLevel;
  allowLowConfidence: boolean;
}): CandidateEmail {
  const { allowLowConfidence, domain, firstName, lastName, pattern, patternConfidence } = options;

  if (!pattern || !domain || patternConfidence === "UNAVAILABLE") {
    return { email: null, status: "UNAVAILABLE", confidence: "UNAVAILABLE" };
  }

  if (patternConfidence === "LOW" && !allowLowConfidence) {
    return { email: null, status: "UNAVAILABLE", confidence: "LOW" };
  }

  const email = generateEmail({ firstName, lastName, domain, pattern });
  if (!email) {
    return { email: null, status: "UNAVAILABLE", confidence: patternConfidence };
  }

  return {
    email,
    status: STATUS_BY_CONFIDENCE[patternConfidence],
    confidence: patternConfidence
  };
}
