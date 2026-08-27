import { describe, expect, it } from "vitest";

import { evaluateDiscoverLocationMatch } from "@/services/prospects/discover-location-matching";

describe("evaluateDiscoverLocationMatch", () => {
  it("accepts explicit public-index United States evidence in structured and full forms", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { country: "United States" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "West Haven, Connecticut, United States" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });

  it("rejects public-index candidates with missing or unrecognized geography", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: null, country: null, state: null, city: null },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: false, reason: "MISSING_METADATA" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Bengaluru", country: "Bengaluru" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: false, reason: "NO_MATCH" });
  });

  it("accepts recognized US state and city-state representations", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "New York", country: "New York" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Austin, TX", city: "Austin", country: "TX" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Hartford, Connecticut", city: "Hartford", country: "Connecticut" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });

  it("accepts United States aliases in either requested or candidate metadata", () => {
    for (const alias of ["USA", "U.S.", "US"]) {
      expect(
        evaluateDiscoverLocationMatch({
          candidate: { location: alias, country: alias },
          requestedLocations: ["United States"],
          context: "PUBLIC_INDEX_PROVIDER"
        })
      ).toEqual({ matches: true, reason: "CONFIRMED" });
    }
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { country: "United States" },
        requestedLocations: ["U.S."],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "CONFIRMED" });
  });

  it("rejects an explicit public-index country contradiction", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: { location: "Toronto, Canada", country: "Canada", city: "Toronto" },
        requestedLocations: ["United States"],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: false, reason: "EXPLICIT_CONTRADICTION" });
  });

  it("keeps trusted structured-provider provenance explicit", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: {},
        requestedLocations: ["United States"],
        context: "TRUSTED_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "MISSING_METADATA" });
  });

  it("keeps cache matching conservative", () => {
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

  it("accepts any candidate when no location was requested", () => {
    expect(
      evaluateDiscoverLocationMatch({
        candidate: {},
        requestedLocations: [],
        context: "PUBLIC_INDEX_PROVIDER"
      })
    ).toEqual({ matches: true, reason: "NO_CONSTRAINT" });
  });
});
