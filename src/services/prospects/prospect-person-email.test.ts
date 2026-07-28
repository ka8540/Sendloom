import { describe, expect, it } from "vitest";

import { overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";

const company = {
  emailDomain: "walmart.com",
  emailDomainConfidence: "HIGH",
  emailPattern: "first.last",
  patternConfidence: "HIGH"
};

function person(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Christy",
    lastName: "Stouffer",
    inferredEmail: null,
    emailStatus: "UNAVAILABLE",
    emailConfidence: "UNAVAILABLE",
    emailPattern: null,
    emailSource: null,
    ...overrides
  } as never;
}

describe("resolveProspectPersonEmail", () => {
  it("repairs stale unavailable values from the canonical company format", () => {
    expect(resolveProspectPersonEmail(person(), company, { allowLowConfidence: false })).toMatchObject({
      inferredEmail: "christy.stouffer@walmart.com",
      emailStatus: "INFERRED_HIGH",
      emailPattern: "first.last",
      emailSource: "PATTERN"
    });
  });

  it.each(["VERIFIED", "INVALID", "SUPPRESSED", "UNSUBSCRIBED"])("preserves %s addresses", (emailStatus) => {
    const existing = person({
      inferredEmail: "protected@walmart.com",
      emailStatus,
      emailConfidence: "HIGH",
      emailSource: "TRUSTED_SOURCE"
    });
    expect(resolveProspectPersonEmail(existing, company, { allowLowConfidence: false }).inferredEmail).toBe(
      "protected@walmart.com"
    );
  });

  it("moves a generated address to the new format even when the old one failed", () => {
    // The regression: a bounced/suppressed address pinned the person to it, so
    // a corrected company format could never reach them and the dead address
    // (and its Invalid pill) survived every format change.
    const existing = person({
      inferredEmail: "cstouffer@walmart.com",
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "flast",
      emailSource: "PATTERN"
    });
    expect(
      resolveProspectPersonEmail(existing, company, {
        allowLowConfidence: false,
        regenerateExistingInferred: true
      })
    ).toMatchObject({
      inferredEmail: "christy.stouffer@walmart.com",
      emailStatus: "INFERRED_HIGH",
      emailPattern: "first.last"
    });
  });

  it("regenerates the SAME address when the format is switched back", () => {
    // The failure record lives on the address, so returning to the pattern that
    // produced it reproduces it exactly — and the read-time overlay marks it
    // Invalid again off the suppression list.
    const existing = person({
      inferredEmail: "christy.stouffer@walmart.com",
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "first.last",
      emailSource: "PATTERN"
    });
    expect(
      resolveProspectPersonEmail(
        existing,
        { ...company, emailPattern: "flast" },
        { allowLowConfidence: false, regenerateExistingInferred: true }
      ).inferredEmail
    ).toBe("cstouffer@walmart.com");
  });
});

describe("invalid status follows the address, not the person", () => {
  // The pill the table shows is overlayEmailCandidateStatus(stored, reasonFor(
  // currentAddress)) — so a status can only be Invalid when the address on
  // screen is the one on the suppression list.
  const suppressed = new Map([["cstouffer@walmart.com", "HARD_BOUNCE"]]);
  const reasonFor = (email: string | null) => (email ? suppressed.get(email) ?? null : null);

  function statusFor(personRow: ReturnType<typeof person>, emailPattern: string) {
    // regenerateExistingInferred mirrors the format-change path, which is what
    // rewrites every generated address after the user edits the email format.
    const derived = resolveProspectPersonEmail(
      personRow,
      { ...company, emailPattern },
      { allowLowConfidence: false, regenerateExistingInferred: true }
    );
    return {
      email: derived.inferredEmail,
      status: overlayEmailCandidateStatus(derived.emailStatus, reasonFor(derived.inferredEmail))
    };
  }

  const failed = person({
    inferredEmail: "cstouffer@walmart.com",
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "flast",
    emailSource: "PATTERN"
  });

  it("clears Invalid when the format generates a different address", () => {
    expect(statusFor(failed, "first.last")).toEqual({
      email: "christy.stouffer@walmart.com",
      status: "INFERRED_HIGH"
    });
  });

  it("shows Invalid again when the format regenerates the failed address", () => {
    expect(statusFor(failed, "flast")).toEqual({ email: "cstouffer@walmart.com", status: "INVALID" });
  });

  it("never marks a person Invalid for an address they no longer hold", () => {
    // Same person, a third pattern that has never failed.
    expect(statusFor(failed, "first").status).toBe("INFERRED_HIGH");
  });
});
