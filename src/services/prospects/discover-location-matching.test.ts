import { describe, expect, it } from "vitest";

import { evaluateDiscoverLocationMatch } from "@/services/prospects/discover-location-matching";

describe("evaluateDiscoverLocationMatch", () => {
  it("accepts provider-confirmed United States geography in structured and full forms", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { country: "United States" },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "West Haven, Connecticut, United States" },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });

  it("trusts provider provenance for missing geography and confirms known city/state hierarchy", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: null, country: null, state: null, city: null },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: true, reason: "MISSING_METADATA" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: {
          location: "Hartford, Connecticut",
          city: "Hartford",
          state: null,
          // The provider parser may place the final partial component here;
          // the shared city/state parser can still recover the country.
          country: "Connecticut"
        },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });

  it("rejects an explicit provider country contradiction", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Toronto, Canada", country: "Canada", city: "Toronto" },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Toronto, Canada" },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
  });

  it("matches cache containment but rejects contradictory or missing durable geography", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "West Haven, Connecticut, United States" },
        requestedLocations: ["United States"],
        context: "CACHE"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Toronto, Canada", country: "Canada" },
        requestedLocations: ["United States"],
        context: "CACHE"
      })
    ).toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: {},
        requestedLocations: ["United States"],
        context: "CACHE"
      })
    ).toEqual({ matches: false, reason: "MISSING_METADATA" });
  });

  it("public SERP geography: explicit contradiction rejects, missing/unknown passes without inventing location", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "London, United Kingdom", country: "United Kingdom" },
        requestedLocations: ["United States"],
        context: "PUBLIC"
      })
    ).toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: {},
        requestedLocations: ["United States"],
        context: "PUBLIC"
      })
    ).toEqual({ matches: true, reason: "MISSING_METADATA" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Boston" },
        requestedLocations: ["United States"],
        context: "PUBLIC"
      })
    ).toEqual({ matches: true, reason: "NO_MATCH" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Chicago, Illinois, United States" },
        requestedLocations: ["United States"],
        context: "PUBLIC"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });
});


describe("city/state country hierarchy", () => {
  it.each(["Dallas, Texas", "Seattle, Washington", "Lynn, Massachusetts", "Tyngsborough, Massachusetts"])("confirms %s for United States without changing the source location", location => {
    for (const context of ["PUBLIC", "CACHE"] as const) {
      expect(evaluateDiscoverLocationMatch({ candidate: { location }, requestedLocations: ["United States"], context }))
        .toEqual({ matches: true, reason: "CONFIRMED" });
    }
  });
  it("does not infer a US state from an ambiguous country or abbreviation", () => {
    expect(evaluateDiscoverLocationMatch({ candidate: { location: "Tbilisi, Georgia" }, requestedLocations: ["United States"], context: "PUBLIC" }))
      .toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
    expect(evaluateDiscoverLocationMatch({ candidate: { location: "City, CA" }, requestedLocations: ["United States"], context: "PUBLIC" }).reason).toBe("NO_MATCH");
  });
});
