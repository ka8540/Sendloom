import { describe, expect, it } from "vitest";

import {
  PersonIdentitySet,
  normalizeProfileUrl,
  personIdentityKeys
} from "@/services/prospects/discover-person-identity";

describe("normalizeProfileUrl", () => {
  it("lowercases, trims, drops query/fragment, strips protocol/www and trailing slash", () => {
    expect(normalizeProfileUrl("https://www.LinkedIn.com/in/Ada/")).toBe("linkedin.com/in/ada");
    expect(normalizeProfileUrl("http://linkedin.com/in/ada?utm=x#frag")).toBe("linkedin.com/in/ada");
    expect(normalizeProfileUrl("  https://www.linkedin.com/in/ada  ")).toBe("linkedin.com/in/ada");
  });

  it("returns null for empty input", () => {
    expect(normalizeProfileUrl(null)).toBeNull();
    expect(normalizeProfileUrl("")).toBeNull();
    expect(normalizeProfileUrl("   ")).toBeNull();
  });
});

describe("personIdentityKeys", () => {
  it("prefers the provider id and also keys on the normalized URL (#17)", () => {
    expect(personIdentityKeys({ sourceProfileId: "ABC", linkedinUrl: "https://www.linkedin.com/in/ada/" })).toEqual([
      "id:abc",
      "url:linkedin.com/in/ada"
    ]);
  });

  it("falls back to URL only when no provider id exists", () => {
    expect(personIdentityKeys({ sourceProfileId: null, linkedinUrl: "https://linkedin.com/in/ada" })).toEqual([
      "url:linkedin.com/in/ada"
    ]);
  });

  it("yields no keys when nothing stable is available", () => {
    expect(personIdentityKeys({ sourceProfileId: null, linkedinUrl: null })).toEqual([]);
  });
});

describe("PersonIdentitySet", () => {
  it("deduplicates the same source id even with a different URL (#17)", () => {
    const set = new PersonIdentitySet([{ sourceProfileId: "p1", linkedinUrl: "https://linkedin.com/in/a" }]);
    expect(set.has({ sourceProfileId: "p1", linkedinUrl: "https://linkedin.com/in/different" })).toBe(true);
  });

  it("deduplicates the same normalized URL even with a different id", () => {
    const set = new PersonIdentitySet([{ sourceProfileId: "p1", linkedinUrl: "https://www.linkedin.com/in/ada/" }]);
    expect(set.has({ sourceProfileId: "p2", linkedinUrl: "http://linkedin.com/in/ada?x=1" })).toBe(true);
  });

  it("does NOT treat two different people who share a name as duplicates (#16)", () => {
    const set = new PersonIdentitySet([{ sourceProfileId: "p1", linkedinUrl: "https://linkedin.com/in/ada-1" }]);
    // Same display name would be identical, but identity uses id/URL only.
    expect(set.has({ sourceProfileId: "p2", linkedinUrl: "https://linkedin.com/in/ada-2" })).toBe(false);
  });

  it("addIfNew records and reports novelty", () => {
    const set = new PersonIdentitySet();
    expect(set.addIfNew({ sourceProfileId: "p1" })).toBe(true);
    expect(set.addIfNew({ sourceProfileId: "p1" })).toBe(false);
  });
});
