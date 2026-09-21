import { describe, expect, it } from "vitest";

import {
  buildDiscoverFingerprintInput,
  canonicalCompanyKey,
  computeDiscoverFingerprint,
  fingerprintHash,
  sameNormalizedIntent
} from "@/services/prospects/discover-cache-fingerprint";

const APPLE = {
  linkedinCompanyUrl: "https://www.linkedin.com/company/apple/",
  officialWebsiteDomain: "apple.com",
  officialDomain: "apple.com",
  normalizedName: "apple"
};

function fp(overrides: {
  company?: typeof APPLE;
  roles?: string[];
  locations?: string[];
  resultLimit?: number;
  cacheVersion?: string;
} = {}): string {
  return computeDiscoverFingerprint({
    company: overrides.company ?? APPLE,
    roles: overrides.roles ?? ["Software Engineer"],
    locations: overrides.locations ?? ["United States"],
    resultLimit: overrides.resultLimit ?? 10,
    cacheVersion: overrides.cacheVersion ?? "v1"
  }).fingerprint;
}

describe("canonicalCompanyKey", () => {
  it("prefers the official domain when both domain and LinkedIn are available", () => {
    expect(canonicalCompanyKey(APPLE)).toBe("domain:apple.com");
    expect(canonicalCompanyKey({
      ...APPLE,
      officialWebsiteDomain: "WWW.Wealthfront.com",
      officialDomain: "wealthfront.com",
      linkedinCompanyUrl: "https://LINKEDIN.com/company/wealthfront"
    })).toBe("domain:wealthfront.com");
  });

  it("falls back to LinkedIn only without an official domain, then to the normalized name", () => {
    expect(canonicalCompanyKey({ ...APPLE, linkedinCompanyUrl: null })).toBe("domain:apple.com");
    expect(canonicalCompanyKey({
      linkedinCompanyUrl: "https://LINKEDIN.com/company/Apple/",
      officialWebsiteDomain: null,
      officialDomain: null,
      normalizedName: "apple inc"
    })).toBe("linkedin:apple");
    expect(
      canonicalCompanyKey({ linkedinCompanyUrl: null, officialWebsiteDomain: null, officialDomain: null, normalizedName: "apple" })
    ).toBe("name:apple");
  });

  it("treats Apple, Apple Inc., and APPLE as the same company once resolved", () => {
    // Resolution confirms the same identity (same LinkedIn / domain) even though
    // the raw name and normalized name differ.
    const a = canonicalCompanyKey({ ...APPLE, normalizedName: "apple" });
    const b = canonicalCompanyKey({ ...APPLE, normalizedName: "apple inc" });
    expect(a).toBe(b);
  });
});

describe("sameNormalizedIntent", () => {
  it("compares normalized role and location sets deterministically", () => {
    expect(sameNormalizedIntent(
      [" Software Engineer ", "software engineer"],
      ["UNITED   STATES"],
      ["software engineer"],
      ["United States"]
    )).toBe(true);
    expect(sameNormalizedIntent(
      ["software engineer"],
      ["united states"],
      ["recruiter"],
      ["united states"]
    )).toBe(false);
    expect(sameNormalizedIntent(
      ["software engineer"],
      ["united states"],
      ["software engineer"],
      ["san francisco"]
    )).toBe(false);
  });
});

describe("discover fingerprint (#1-#9)", () => {
  it("is stable for the same company, roles, and locations (#1)", () => {
    expect(fp()).toBe(fp());
  });

  it("ignores role order (#2)", () => {
    expect(fp({ roles: ["Software Engineer", "Recruiter"] })).toBe(fp({ roles: ["Recruiter", "Software Engineer"] }));
  });

  it("ignores location order (#3)", () => {
    expect(fp({ locations: ["United States", "Canada"] })).toBe(fp({ locations: ["Canada", "United States"] }));
  });

  it("ignores duplicate / casing-only filters (#4)", () => {
    expect(fp({ roles: ["Software Engineer", "software engineer ", "SOFTWARE ENGINEER"] })).toBe(
      fp({ roles: ["Software Engineer"] })
    );
    expect(fp({ locations: ["United States", "united states"] })).toBe(fp({ locations: ["United States"] }));
  });

  it("changes for a different company (#5)", () => {
    const microsoft = {
      linkedinCompanyUrl: "https://www.linkedin.com/company/microsoft/",
      officialWebsiteDomain: "microsoft.com",
      officialDomain: "microsoft.com",
      normalizedName: "microsoft"
    };
    expect(fp({ company: microsoft })).not.toBe(fp());
  });

  it("changes for a different role (#6)", () => {
    expect(fp({ roles: ["Recruiter"] })).not.toBe(fp({ roles: ["Software Engineer"] }));
  });

  it("changes for a different location (#7) — California is not United States", () => {
    expect(fp({ locations: ["California"] })).not.toBe(fp({ locations: ["United States"] }));
  });

  it("changes when the cache version changes (#8)", () => {
    expect(fp({ cacheVersion: "v2" })).not.toBe(fp({ cacheVersion: "v1" }));
  });

  it("includes the fixed result limit (#9)", () => {
    expect(fp({ resultLimit: 25 })).not.toBe(fp({ resultLimit: 10 }));
  });

  it("normalizes + sorts the canonical input arrays", () => {
    const input = buildDiscoverFingerprintInput({
      company: APPLE,
      roles: ["Recruiter", "Software Engineer", "recruiter"],
      locations: ["United States", "Canada"],
      resultLimit: 10,
      cacheVersion: "v1"
    });
    expect(input.roles).toEqual(["recruiter", "software engineer"]);
    expect(input.locations).toEqual(["canada", "united states"]);
    expect(input.companyKey).toBe("domain:apple.com");
    // Hash is deterministic regardless of construction order.
    expect(fingerprintHash(input)).toBe(fingerprintHash({ ...input, roles: ["software engineer", "recruiter"] }));
  });
});
