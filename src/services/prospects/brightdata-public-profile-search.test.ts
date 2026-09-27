import { describe, expect, it, vi } from "vitest";

import type { BrightDataPeopleSearchProvider, BrightOrganicResult } from "./brightdata-google-search-provider";
import { BrightDataPublicProfileSearchService } from "./brightdata-public-profile-search";

const row = (slug: string, headline = "Software Engineer at Acme", location = "New York, New York, United States"): BrightOrganicResult => ({
  title: `Jane ${slug} - ${headline} | LinkedIn`,
  url: `https://www.linkedin.com/in/${slug}`,
  rawUrl: `https://www.linkedin.com/in/${slug}`,
  displayedUrl: `linkedin.com › in › ${slug}`,
  snippet: [headline, location].filter(Boolean).join(" · "),
  evidence: [headline, location].filter(Boolean)
});

const input = {
  companyName: "Acme",
  companyLinkedinUrl: "https://linkedin.com/company/acme",
  jobTitles: ["Software Engineer"],
  locations: ["New York"],
  maxResults: 10
};

describe("BrightDataPublicProfileSearchService", () => {
  it("keeps supported city/state/country evidence and rejects explicit contradictions", async () => {
    const provider: BrightDataPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        results: [row("valid"), row("wrong", "Software Engineer at Acme", "London, United Kingdom")],
        rawOrganicResults: 2,
        page: 1,
        exhausted: true
      }))
    };
    const result = await new BrightDataPublicProfileSearchService(provider, 0).searchProfiles(input);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({
      sourceProfileId: "valid",
      location: "New York, New York, United States",
      city: "New York",
      state: "New York",
      country: "United States"
    });
    expect(result.diagnostics.locationContradictionRejected).toBe(1);
  });

  it("uses one bounded enrichment request when the primary card has no location", async () => {
    const search = vi.fn(async (_query: string, options: { page: number }) => ({
      results: search.mock.calls.length === 1 ? [row("jane", "Software Engineer at Acme", "")] : [row("jane")],
      rawOrganicResults: 1,
      page: options.page,
      exhausted: true
    }));
    const result = await new BrightDataPublicProfileSearchService({ configured: true, search }, 1).searchProfiles(input);
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.profiles[0]).toMatchObject({ city: "New York", country: "United States" });
    expect(result.diagnostics.enrichmentCalls).toBe(1);
  });

  it("never fabricates a requested city and rejects former employees", async () => {
    const provider: BrightDataPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        results: [row("missing", "Software Engineer at Acme", ""), row("former", "Former Software Engineer at Acme")],
        rawOrganicResults: 2,
        page: 1,
        exhausted: true
      }))
    };
    const result = await new BrightDataPublicProfileSearchService(provider, 0).searchProfiles(input);
    expect(result.profiles).toEqual([]);
    expect(result.diagnostics.locationMissing).toBe(1);
    expect(result.diagnostics.formerEmployeeRejected).toBe(1);
  });

  it("rejects an explicit current-employer contradiction even with a positive headline", async () => {
    const contradictory = row("contradiction");
    contradictory.snippet = "Currently Software Engineer at OtherCo · New York, New York, United States";
    contradictory.evidence = [contradictory.snippet];
    const provider: BrightDataPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({ results: [contradictory], rawOrganicResults: 1, page: 1, exhausted: true }))
    };
    const result = await new BrightDataPublicProfileSearchService(provider, 0).searchProfiles(input);
    expect(result.profiles).toEqual([]);
    expect(result.diagnostics.companyContradictionRejected).toBe(1);
  });

  it("allows country-only provenance when no public evidence contradicts it", async () => {
    const provider: BrightDataPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({ results: [row("country", "Software Engineer at Acme", "")], rawOrganicResults: 1, page: 1, exhausted: true }))
    };
    const result = await new BrightDataPublicProfileSearchService(provider, 0).searchProfiles({ ...input, locations: ["United States"] });
    expect(result.profiles[0]).toMatchObject({ location: "United States", city: null, state: null, country: "United States" });
  });

  it("counts only one usable person after former, wrong-company, duplicate, and wrong-location rejections", async () => {
    const duplicate = row("only-valid");
    const provider: BrightDataPeopleSearchProvider = {
      configured: true,
      search: vi.fn(async () => ({
        results: [
          row("former-1", "Former Software Engineer at Acme"),
          row("former-2", "Previously Software Engineer at Acme"),
          row("former-3", "Ex-Software Engineer at Acme"),
          row("other-1", "Software Engineer at OtherCo"),
          row("other-2", "Software Engineer at Elsewhere"),
          duplicate,
          { ...duplicate },
          { ...duplicate },
          row("wrong-location-1", "Software Engineer at Acme", "London, United Kingdom"),
          row("wrong-location-2", "Software Engineer at Acme", "Paris, France")
        ],
        rawOrganicResults: 10,
        page: 1,
        exhausted: true
      }))
    };
    const result = await new BrightDataPublicProfileSearchService(provider, 0).searchProfiles(input);
    expect(result.profiles.map((profile) => profile.sourceProfileId)).toEqual(["only-valid"]);
    expect(result.diagnostics).toMatchObject({
      rawBrightResults: 10,
      linkedInCandidates: 10,
      formerEmployeeRejected: 3,
      companyContradictionRejected: 2,
      duplicateRejected: 2,
      locationContradictionRejected: 2
    });
  });
});
