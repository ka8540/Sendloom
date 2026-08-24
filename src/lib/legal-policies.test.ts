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

  it("has valid release metadata and changed content for the August 24, 2026 account-recovery release", () => {
    const previousReleaseHashes = {
      terms: "53090cd2b21140fe2d1472fe424dadb900d84f37e5f5f1acd5ba5f8804f089de",
      privacy: "b80e1f00921699932ea60a992df75a77611752a99d71db0830e60606f810ca2a",
      abuse: "217e658352ae89ccf9e9750a08f9508d2589ac868da2e16357f379c769856162"
    } as const;

    expect(validateLegalPolicyRegistry()).toEqual([]);
    expect(new Set(LEGAL_POLICY_LIST.map((policy) => policy.releaseGroup))).toEqual(
      new Set(["2026-08-24-account-recovery-security"])
    );
    for (const policy of LEGAL_POLICY_LIST) {
      expect(policy.version).toBe("2026-08-24");
      expect(policy.releaseGroup).toBe("2026-08-24-account-recovery-security");
      expect(policy.lastUpdated).toBe("August 24, 2026");
      expect(policy.changeSummary.length).toBeGreaterThan(0);
      expect(policy.sections.length).toBeGreaterThan(0);
      expect(computeLegalPolicyContentHash(policy)).toMatch(/^[a-f0-9]{64}$/);
      expect(computeLegalPolicyContentHash(policy)).not.toBe(previousReleaseHashes[policy.id]);
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
    const changedReleaseGroup: LegalPolicy = { ...original, releaseGroup: "different-delivery-group" };

    expect(computeLegalPolicyContentHash(changedContent)).not.toBe(computeLegalPolicyContentHash(original));
    expect(computeLegalPolicyContentHash(changedDate)).not.toBe(computeLegalPolicyContentHash(original));
    expect(computeLegalPolicyContentHash(changedReleaseGroup)).toBe(computeLegalPolicyContentHash(original));
  });

  it("rejects impossible release dates", () => {
    expect(validateLegalPolicyRegistry([{ ...LEGAL_POLICIES.privacy, version: "2026-02-30" }])).toContain(
      "Invalid version for privacy: 2026-02-30"
    );
  });

  it("requires an explicit non-empty releaseGroup", () => {
    expect(validateLegalPolicyRegistry([{ ...LEGAL_POLICIES.privacy, releaseGroup: "" }])).toContain(
      "Missing releaseGroup for privacy"
    );
  });
});
