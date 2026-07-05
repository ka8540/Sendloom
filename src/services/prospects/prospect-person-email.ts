import type { ProspectCompany, ProspectPerson } from "@prisma/client";

import { type ConfidenceLevel } from "@/lib/prospect-enums";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

export type ProspectPersonEmailFields = Pick<
  ProspectPerson,
  "inferredEmail" | "emailStatus" | "emailConfidence" | "emailPattern" | "emailSource"
>;

export type ProspectPersonEmailInput = Pick<
  ProspectPerson,
  | "firstName"
  | "lastName"
  | "inferredEmail"
  | "emailStatus"
  | "emailConfidence"
  | "emailPattern"
  | "emailSource"
>;

export type ProspectCompanyEmailInput = Pick<
  ProspectCompany,
  "emailDomain" | "emailDomainConfidence" | "emailPattern" | "patternConfidence"
>;

const REGENERATABLE_STATUSES = new Set([
  "UNAVAILABLE",
  "INFERRED_HIGH",
  "INFERRED_MEDIUM",
  "INFERRED_LOW"
]);

export function shouldRegenerateProspectEmail(person: ProspectPersonEmailInput, suppressed = false): boolean {
  if (suppressed || !REGENERATABLE_STATUSES.has(person.emailStatus)) {
    return false;
  }
  // PATTERN is Sendloom's deterministic candidate source. Any other populated
  // source is treated as stronger/trusted and is never replaced here.
  return !person.emailSource || person.emailSource === "PATTERN";
}

/**
 * Derive one person's candidate from the current canonical company format.
 * This is the shared read/write path for GraphQL, export/import, initial search
 * materialization, Add More, and format-change repair.
 */
export function resolveProspectPersonEmail(
  person: ProspectPersonEmailInput,
  company: ProspectCompanyEmailInput,
  options: { allowLowConfidence: boolean; suppressed?: boolean; regenerateExistingInferred?: boolean }
): ProspectPersonEmailFields {
  if (!shouldRegenerateProspectEmail(person, options.suppressed)) {
    return {
      inferredEmail: person.inferredEmail,
      emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence,
      emailPattern: person.emailPattern,
      emailSource: person.emailSource
    };
  }

  if (
    person.emailStatus.startsWith("INFERRED_") &&
    person.inferredEmail &&
    !options.regenerateExistingInferred
  ) {
    return {
      inferredEmail: person.inferredEmail,
      emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence,
      emailPattern: person.emailPattern,
      emailSource: person.emailSource
    };
  }

  const patternConfidence: ConfidenceLevel = combinedEmailConfidence(
    company.emailDomainConfidence,
    company.patternConfidence
  );
  const currentAddressDomain = person.inferredEmail?.split("@")[1] ?? null;
  if (
    person.emailStatus.startsWith("INFERRED_") &&
    person.inferredEmail &&
    (!person.emailPattern || person.emailPattern === company.emailPattern) &&
    normalizeDomain(currentAddressDomain) === normalizeDomain(company.emailDomain) &&
    person.emailConfidence === patternConfidence
  ) {
    return {
      inferredEmail: person.inferredEmail,
      emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence,
      emailPattern: person.emailPattern,
      emailSource: person.emailSource
    };
  }

  const candidate = resolveCandidateEmail({
    firstName: person.firstName,
    lastName: person.lastName,
    domain: company.emailDomain,
    pattern: company.emailPattern,
    patternConfidence,
    allowLowConfidence: options.allowLowConfidence
  });

  return {
    inferredEmail: candidate.email,
    emailStatus: candidate.status,
    emailConfidence: candidate.confidence,
    emailPattern: candidate.email ? company.emailPattern : null,
    emailSource: candidate.email ? "PATTERN" : null
  };
}
