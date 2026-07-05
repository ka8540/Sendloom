import { describe, expect, it } from "vitest";

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

  it("preserves a live-suppressed inferred address", () => {
    const existing = person({
      inferredEmail: "old@walmart.com",
      emailStatus: "INFERRED_HIGH",
      emailConfidence: "HIGH",
      emailPattern: "flast",
      emailSource: "PATTERN"
    });
    expect(
      resolveProspectPersonEmail(existing, company, { allowLowConfidence: false, suppressed: true }).inferredEmail
    ).toBe("old@walmart.com");
  });
});
