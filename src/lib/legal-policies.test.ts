import { describe, expect, it } from "vitest";

import { computeLegalPolicyContentHash } from "@/lib/legal-policy-fingerprint";
import {
  LEGAL_POLICIES,
  LEGAL_POLICY_LIST,
  validateLegalPolicyRegistry,
  type LegalPolicy
} from "@/lib/legal-policies";

describe("legal policy registry", () => {
  it("contains the three canonical policies and routes", () => {
    expect(Object.keys(LEGAL_POLICIES)).toEqual(["terms", "privacy", "abuse"]);
    expect(LEGAL_POLICIES.terms).toMatchObject({ title: "Terms of Service", path: "/terms" });
    expect(LEGAL_POLICIES.privacy).toMatchObject({ title: "Privacy Policy", path: "/privacy" });
    expect(LEGAL_POLICIES.abuse).toMatchObject({ title: "Anti-Abuse Policy", path: "/abuse" });
  });

  it("has valid release metadata for the August 23, 2026 policy updates", () => {
    expect(validateLegalPolicyRegistry()).toEqual([]);
    for (const policy of LEGAL_POLICY_LIST) {
      expect(policy.version).toBe("2026-08-23");
      expect(policy.lastUpdated).toBe("August 23, 2026");
      expect(policy.changeSummary.length).toBeGreaterThan(0);
      expect(policy.sections.length).toBeGreaterThan(0);
      expect(computeLegalPolicyContentHash(policy)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("changes the fingerprint for policy text or meaningful metadata edits", () => {
    const original = LEGAL_POLICIES.privacy;
    const changedContent: LegalPolicy = {
      ...original,
      sections: [
        ...original.sections,
        { id: "new-section", title: "New section", paragraphs: ["New policy text."] }
      ]
    };
    const changedDate: LegalPolicy = { ...original, lastUpdated: "August 2, 2026" };

    expect(computeLegalPolicyContentHash(changedContent)).not.toBe(computeLegalPolicyContentHash(original));
    expect(computeLegalPolicyContentHash(changedDate)).not.toBe(computeLegalPolicyContentHash(original));
  });

  it("rejects impossible release dates", () => {
    expect(validateLegalPolicyRegistry([{ ...LEGAL_POLICIES.privacy, version: "2026-02-30" }])).toContain(
      "Invalid version for privacy: 2026-02-30"
    );
  });
});
