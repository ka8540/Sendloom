import { type ConfidenceLevel } from "@/lib/prospect-enums";

/** Coerce an arbitrary stored value to a known confidence level (else UNAVAILABLE). */
export function coerceConfidenceLevelSafe(value: string | null | undefined): ConfidenceLevel {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : "UNAVAILABLE";
}

/**
 * Combine the company email-domain confidence and pattern confidence into the
 * single candidate-email confidence used when generating an address. The result
 * is the weakest of the two: if either is UNAVAILABLE the email is unavailable,
 * otherwise it steps down to the lowest present level.
 */
export function combinedEmailConfidence(
  emailDomainConfidence: string | null | undefined,
  patternConfidence: string | null | undefined
): ConfidenceLevel {
  const domain = coerceConfidenceLevelSafe(emailDomainConfidence);
  const pattern = coerceConfidenceLevelSafe(patternConfidence);
  if (domain === "UNAVAILABLE" || pattern === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }
  if (domain === "LOW" || pattern === "LOW") {
    return "LOW";
  }
  if (domain === "MEDIUM" || pattern === "MEDIUM") {
    return "MEDIUM";
  }
  return "HIGH";
}
