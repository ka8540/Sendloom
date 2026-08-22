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

  it("trusts provider provenance when returned geography is missing or only city/state", () => {
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
          // it is not reliable evidence of a different country.
          country: "Connecticut"
        },
        requestedLocations: ["United States"],
        context: "PROVIDER"
      })
    ).toEqual({ matches: true, reason: "MISSING_METADATA" });
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
});
