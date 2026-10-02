import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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

  it("releases the changed policies together with new content fingerprints", () => {
    const previousReleaseHashes = {
      terms: "f2464b731634b12ce6dcdc79d6d26133be7709f5cf31ceb036e3cead378a1999",
      privacy: "9b51c8de4c92ad8b2dcc729d1c0f2a866547a11677f8b4fc5939f0180dd20610",
      abuse: "d6be738343438cd62c528692c068913182c8dface24bceff1dcfeabc8654bc4b"
    } as const;

    expect(validateLegalPolicyRegistry()).toEqual([]);
    expect(new Set(LEGAL_POLICY_LIST.map((policy) => policy.releaseGroup))).toEqual(
      new Set(["2026-10-02-account-deletion"])
    );
    for (const policy of LEGAL_POLICY_LIST) {
      expect(policy.version).toBe("2026-10-02");
      expect(policy.releaseGroup).toBe("2026-10-02-account-deletion");
      expect(policy.lastUpdated).toBe("October 2, 2026");
      expect(policy.changeSummary.length).toBeGreaterThan(0);
      expect(policy.sections.length).toBeGreaterThan(0);
      expect(computeLegalPolicyContentHash(policy)).toMatch(/^[a-f0-9]{64}$/);
      expect(computeLegalPolicyContentHash(policy)).not.toBe(previousReleaseHashes[policy.id]);
    }
  });

  it("renders the deletion policy sections through the existing public Terms and Privacy pages", () => {
    const termsPage = readFileSync("src/app/terms/page.tsx", "utf8");
    const privacyPage = readFileSync("src/app/privacy/page.tsx", "utf8");
    expect(termsPage).toContain("sections={policy.sections}");
    expect(privacyPage).toContain("sections={policy.sections}");
    const terms = LEGAL_POLICIES.terms.sections.find((section) => section.id === "account-deletion");
    const privacy = LEGAL_POLICIES.privacy.sections.find((section) => section.id === "account-and-data-deletion");
    expect(terms?.paragraphs?.join(" ")).toContain("Delete my account and outreach data");
    expect(privacy?.paragraphs?.join(" ")).toContain("eligible user-owned private records");
    expect(LEGAL_POLICIES.privacy.sections.find((section) => section.id === "records-that-remain")?.paragraphs?.join(" ")).toContain("audit and security event history");
    expect(LEGAL_POLICIES.abuse.sections.find((section) => section.id === "enforcement")?.paragraphs?.join(" ")).toContain("Deleting an account");
    expect(JSON.stringify(LEGAL_POLICIES.privacy.sections)).not.toContain("within 30 days");
  });

  it("leaves the existing eligibility acceptance gate tied to timestamps", () => {
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    const eligibilityRoute = readFileSync("src/app/api/auth/verify-eligibility/route.ts", "utf8");
    expect(layout).toContain("!user.termsAcceptedAt || !user.privacyAcceptedAt || !user.antiAbuseAcceptedAt");
    expect(layout).not.toContain("LEGAL_POLICIES");
    expect(eligibilityRoute).toContain('const POLICY_VERSION = "1.0"');
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
