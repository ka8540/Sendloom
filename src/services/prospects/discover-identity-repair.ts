// Repair planning for Discover people already stored with a malformed identity.
//
// Deliberately pure: it decides WHAT should change for one stored row and
// returns a plan. The script (scripts/repair-discover-person-identities.ts)
// owns batching and writes, so the decision logic here is unit-testable and
// shared by both person stores — a user's own ProspectPerson rows and the shared
// DiscoverSearchCachePerson pool. Neither store may be repaired by a second,
// slightly-different implementation.
//
// Two properties are non-negotiable:
//  - IDEMPOTENT. A plan is only "changed" when a field genuinely differs, so a
//    second run over repaired data produces zero writes.
//  - NARROW. A row is touched only because its NAME is wrong or because its
//    stored address is not derivable from its canonical identity. A company
//    simply changing its email format is not this script's business.

import { type ConfidenceLevel } from "@/lib/prospect-enums";
import { resolveCandidateEmail } from "@/services/prospects/email-generation-service";
import { combinedEmailConfidence } from "@/services/prospects/prospect-email-confidence";
import { type PersonIdentityStatus, parsePersonName } from "@/services/prospects/prospect-person-name";
import { shouldRegenerateProspectEmail } from "@/services/prospects/prospect-person-email";

/** The stored person fields the repair reads. Satisfied by both person stores. */
export type RepairablePerson = {
  firstName: string;
  lastName: string;
  fullName: string;
  inferredEmail: string | null;
  emailStatus: string;
  emailConfidence: string;
  emailPattern: string | null;
  emailSource: string | null;
};

/** The stored company email format the repair regenerates against. */
export type RepairableEmailFormat = {
  emailDomain: string | null;
  emailDomainConfidence: string;
  emailPattern: string | null;
  patternConfidence: string;
};

export type RepairedFields = {
  firstName: string;
  lastName: string;
  fullName: string;
  inferredEmail: string | null;
  emailStatus: string;
  emailConfidence: string;
  emailPattern: string | null;
  emailSource: string | null;
};

export type IdentityRepairPlan = {
  /** True when at least one stored field must be written. */
  changed: boolean;
  nameChanged: boolean;
  /**
   * NONE      — the stored address is already consistent with the identity.
   * REGENERATED — a safe address was recomputed from the canonical identity.
   * CLEARED   — a stale/malformed address was removed with no replacement.
   */
  emailAction: "NONE" | "REGENERATED" | "CLEARED";
  identityStatus: PersonIdentityStatus;
  fields: RepairedFields;
};

/**
 * Plan the repair of one stored person.
 *
 * The email is reconsidered only when the canonical name changed or when the
 * stored address does not match what the canonical identity would produce under
 * the row's own recorded pattern. That second condition is what catches
 * "jared.chomba@apple.com" and "jared.c@apple.com" while leaving a healthy row
 * byte-for-byte untouched.
 *
 * Addresses Sendloom did not generate (verified or otherwise externally
 * sourced) are never rewritten — that policy lives in
 * `shouldRegenerateProspectEmail` and is reused here rather than restated.
 */
export function planPersonIdentityRepair(
  person: RepairablePerson,
  format: RepairableEmailFormat,
  options: { allowLowConfidence: boolean }
): IdentityRepairPlan {
  const identity = parsePersonName({
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName
  });

  const firstName = identity.firstName ?? "";
  const lastName = identity.lastName ?? "";
  // An unusable identity keeps whatever display name it had — deleting the only
  // human-readable trace of a person is worse than an odd-looking name.
  const fullName = identity.fullName || person.fullName;

  const nameChanged =
    firstName !== person.firstName || lastName !== person.lastName || fullName !== person.fullName;

  const unchangedEmail = {
    inferredEmail: person.inferredEmail,
    emailStatus: person.emailStatus,
    emailConfidence: person.emailConfidence,
    emailPattern: person.emailPattern,
    emailSource: person.emailSource
  };

  // Externally sourced/verified addresses are out of scope entirely.
  if (!shouldRegenerateProspectEmail(person)) {
    return {
      changed: nameChanged,
      nameChanged,
      emailAction: "NONE",
      identityStatus: identity.status,
      fields: { firstName, lastName, fullName, ...unchangedEmail }
    };
  }

  // What the CANONICAL identity would produce under the address this row
  // already claims to follow. A mismatch means the stored address was built
  // from a malformed name.
  const storedDomain = person.inferredEmail?.split("@")[1] ?? null;
  const consistentWithIdentity =
    person.inferredEmail === null ||
    (person.emailPattern !== null &&
      storedDomain !== null &&
      resolveCandidateEmail({
        firstName,
        lastName,
        domain: storedDomain,
        pattern: person.emailPattern,
        patternConfidence: "HIGH",
        allowLowConfidence: true
      }).email === person.inferredEmail);

  if (!nameChanged && consistentWithIdentity) {
    return {
      changed: false,
      nameChanged: false,
      emailAction: "NONE",
      identityStatus: identity.status,
      fields: { firstName, lastName, fullName, ...unchangedEmail }
    };
  }

  // Recompute from the company's CURRENT canonical format under the existing
  // generation policy. No pattern is invented and confidence is never relaxed;
  // when the company has no usable format the address is simply cleared.
  const patternConfidence: ConfidenceLevel = combinedEmailConfidence(
    format.emailDomainConfidence,
    format.patternConfidence
  );
  const candidate = resolveCandidateEmail({
    firstName,
    lastName,
    domain: format.emailDomain,
    pattern: format.emailPattern,
    patternConfidence,
    allowLowConfidence: options.allowLowConfidence
  });

  const email = {
    inferredEmail: candidate.email,
    emailStatus: candidate.status,
    emailConfidence: candidate.confidence,
    emailPattern: candidate.email ? format.emailPattern : null,
    emailSource: candidate.email ? "PATTERN" : null
  };

  const emailChanged =
    email.inferredEmail !== person.inferredEmail ||
    email.emailStatus !== person.emailStatus ||
    email.emailConfidence !== person.emailConfidence ||
    email.emailPattern !== person.emailPattern ||
    email.emailSource !== person.emailSource;

  return {
    changed: nameChanged || emailChanged,
    nameChanged,
    emailAction: !emailChanged ? "NONE" : candidate.email ? "REGENERATED" : "CLEARED",
    identityStatus: identity.status,
    fields: { firstName, lastName, fullName, ...email }
  };
}

/** Aggregate, PII-free counters for a repair run. Safe to print. */
export type IdentityRepairStats = {
  rowsScanned: number;
  unchanged: number;
  deterministicNamesFixed: number;
  ambiguousNamesFound: number;
  aiResolved: number;
  aiUnavailable: number;
  inferredEmailsRecomputed: number;
  malformedEmailsCleared: number;
  failures: number;
};

export function emptyRepairStats(): IdentityRepairStats {
  return {
    rowsScanned: 0,
    unchanged: 0,
    deterministicNamesFixed: 0,
    ambiguousNamesFound: 0,
    aiResolved: 0,
    aiUnavailable: 0,
    inferredEmailsRecomputed: 0,
    malformedEmailsCleared: 0,
    failures: 0
  };
}

/** Fold one plan into the running counters. */
export function recordRepairPlan(stats: IdentityRepairStats, plan: IdentityRepairPlan): void {
  stats.rowsScanned += 1;
  if (plan.nameChanged) {
    stats.deterministicNamesFixed += 1;
  }
  if (plan.identityStatus === "AMBIGUOUS" || plan.identityStatus === "INCOMPLETE") {
    stats.ambiguousNamesFound += 1;
  }
  if (plan.emailAction === "REGENERATED") {
    stats.inferredEmailsRecomputed += 1;
  }
  if (plan.emailAction === "CLEARED") {
    stats.malformedEmailsCleared += 1;
  }
  if (!plan.changed) {
    stats.unchanged += 1;
  }
}
