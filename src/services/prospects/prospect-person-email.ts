import { type DiscoverNameInput, nameStateFields, readNameStamp, isPlainDiscoverName } from "@/services/prospects/discover-name-contract";
import type { ProspectCompany, ProspectPerson } from "@prisma/client";

import { type ConfidenceLevel } from "@/lib/prospect-enums";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

export type ProspectPersonEmailFields = Pick<
  ProspectPerson,
  "inferredEmail" | "emailStatus" | "emailConfidence" | "emailPattern" | "emailSource"
>;

export type ProspectPersonEmailInput = Partial<Pick<DiscoverNameInput, "sourceName" | "nameNormalization" | "fullName">> & Pick<
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

/**
 * Whether this person's address is Sendloom's own generated guess, and so must
 * follow the company's current format.
 *
 * Deliberately NOT gated on whether the person's CURRENT address is
 * suppressed/bounced. A failure belongs to the address that failed, not to the
 * person: freezing the row on a spent address meant a new pattern could never
 * be applied to them, so a corrected email format left the old dead address —
 * and its Invalid pill — on screen forever. The record of the failure lives in
 * the suppression list, keyed by address, and is overlaid at read time onto
 * whatever address is current; switch the pattern back and the same address is
 * regenerated and reads Invalid again.
 */
export function shouldRegenerateProspectEmail(person: ProspectPersonEmailInput): boolean {
  if (!REGENERATABLE_STATUSES.has(person.emailStatus)) {
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
  options: { allowLowConfidence: boolean; regenerateExistingInferred?: boolean }
): ProspectPersonEmailFields {
  if (!shouldRegenerateProspectEmail(person)) {
    return {
      inferredEmail: person.inferredEmail,
      emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence,
      emailPattern: person.emailPattern,
      emailSource: person.emailSource
    };
  }

  const stamp = readNameStamp(person);
  const safeUnchangedName = stamp ? stamp.canGenerateEmail && !stamp.nameChanged :
    isPlainDiscoverName(`${person.firstName} ${person.lastName}`);
  if (!options.regenerateExistingInferred && safeUnchangedName && person.inferredEmail && person.emailStatus.startsWith("INFERRED_")) {
    return { inferredEmail: person.inferredEmail, emailStatus: person.emailStatus,
      emailConfidence: person.emailConfidence, emailPattern: person.emailPattern, emailSource: person.emailSource };
  }

  const patternConfidence: ConfidenceLevel = combinedEmailConfidence(
    company.emailDomainConfidence, company.patternConfidence
  );
  const candidate = resolveCandidateEmail({
    ...nameStateFields(person),
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
