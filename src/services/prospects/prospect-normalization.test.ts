import { describe, expect, it } from "vitest";

import {
  isLinkedInCompanyUrl,
  isLinkedInProfileUrl,
  isPersonalEmailDomain,
  isValidCompanyDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeTitle,
  parseLocation
} from "@/services/prospects/prospect-normalization";

describe("normalizeCompanyName", () => {
  it("strips corporate suffixes and punctuation", () => {
    expect(normalizeCompanyName("Apple Inc.")).toBe("apple");
    expect(normalizeCompanyName("Stripe, LLC")).toBe("stripe");
    expect(normalizeCompanyName("Acme Technologies Ltd")).toBe("acme");
  });

  it("is stable across casing and spacing", () => {
    expect(normalizeCompanyName("  OpenAI  ")).toBe(normalizeCompanyName("openai"));
  });
});

describe("normalizeDomain", () => {
  it("strips protocol, www, and paths", () => {
    expect(normalizeDomain("https://www.Apple.com/jobs?x=1")).toBe("apple.com");
    expect(normalizeDomain("HTTP://Stripe.com")).toBe("stripe.com");
  });

  it("returns null for non-domains", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("personal vs company domains", () => {
  it("flags common personal mailbox domains", () => {
    expect(isPersonalEmailDomain("gmail.com")).toBe(true);
    expect(isPersonalEmailDomain("outlook.com")).toBe(true);
    expect(isPersonalEmailDomain("apple.com")).toBe(false);
  });

  it("treats only valid non-personal domains as company domains", () => {
    expect(isValidCompanyDomain("apple.com")).toBe(true);
    expect(isValidCompanyDomain("gmail.com")).toBe(false);
    expect(isValidCompanyDomain("garbage")).toBe(false);
  });
});

describe("linkedin url detection", () => {
  it("distinguishes company and profile urls", () => {
    expect(isLinkedInCompanyUrl("https://www.linkedin.com/company/apple/")).toBe(true);
    expect(isLinkedInCompanyUrl("https://www.linkedin.com/in/jane-doe")).toBe(false);
    expect(isLinkedInProfileUrl("https://www.linkedin.com/in/jane-doe")).toBe(true);
    expect(isLinkedInCompanyUrl("https://example.com/company/apple")).toBe(false);
  });
});

// normalizeNameForEmail now lives in prospect-person-name.ts alongside the
// canonical identity parser it delegates to; its tests live there too.

describe("normalizeTitle", () => {
  it("lowercases and collapses punctuation/whitespace", () => {
    expect(normalizeTitle("Sr. Software Engineer  ")).toBe("sr software engineer");
    expect(normalizeTitle("People & Culture")).toBe("people & culture");
  });
});

describe("parseLocation", () => {
  it("splits city/state/country", () => {
    expect(parseLocation("Cupertino, California, United States")).toEqual({
      location: "Cupertino, California, United States",
      city: "Cupertino",
      state: "California",
      country: "United States"
    });
  });

  it("handles a single-part location as country", () => {
    expect(parseLocation("United States")).toMatchObject({ country: "United States", city: null });
  });
});
