import { describe, expect, it, vi } from "vitest";

import { normalizeProfile, type ApifyProfileSearchService, type NormalizedProfile } from "./apify-profile-search";
import { BrightDataSearchError } from "./brightdata-google-search-provider";
import type { BrightProfileSearchProvider } from "./brightdata-public-profile-search";
import { DiscoverPeopleProviderOrchestrator } from "./discover-people-provider-orchestrator";
import { PersonIdentitySet } from "./discover-person-identity";
import { createAiBudget } from "./prospect-ai";

function profile(id: string): NormalizedProfile {
  return normalizeProfile({
    id,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    fullName: `Jane ${id}`,
    currentTitle: "Software Engineer",
    currentCompany: "Acme",
    location: "New York, New York, United States"
  })!;
}

function build(brightProfiles: NormalizedProfile[], apifyProfiles: NormalizedProfile[] = [], brightError?: Error) {
  const bright: BrightProfileSearchProvider = {
    configured: true,
    searchProfiles: vi.fn(async () => {
      if (brightError) throw brightError;
      return {
        profiles: brightProfiles,
        nextPage: 2,
        exhausted: true,
        diagnostics: {
          rawBrightResults: brightProfiles.length,
          linkedInCandidates: brightProfiles.length,
          currentEmploymentAccepted: brightProfiles.length,
          formerEmployeeRejected: 0,
          companyContradictionRejected: 0,
          companyInsufficientRejected: 0,
          locationAccepted: brightProfiles.length,
          locationMissing: 0,
          locationContradictionRejected: 0,
          duplicateRejected: 0,
          enrichmentCalls: 0
        }
      };
    })
  };
  const apify = {
    searchProfiles: vi.fn(async () => ({
      profiles: apifyProfiles,
      runId: "run",
      datasetId: "dataset",
      totalFound: apifyProfiles.length,
      diagnostics: {
        itemsReturned: apifyProfiles.length,
        parsedCandidates: apifyProfiles.length,
        rejectedBySchema: 0,
        duplicateItems: 0,
        companyMatched: apifyProfiles.length,
        rejectedByCompany: 0
      }
    }))
  } as unknown as ApifyProfileSearchService;
  const roleClassifier = {
    classify: vi.fn(async (titles: string[]) => new Map(titles.map((title) => [title.toLowerCase(), { category: "SOFTWARE_ENGINEERING" }])))
  };
  const roleIntelligence = {
    enabled: false,
    buildProviderTitlePlan: vi.fn(async (titles: readonly string[]) => [...titles]),
    filterAndRankPeople: vi.fn(async ({ people }: { people: unknown[] }) => people)
  };
  return {
    bright,
    apify,
    orchestrator: new DiscoverPeopleProviderOrchestrator({
      bright,
      apify,
      roleClassifier: roleClassifier as never,
      roleIntelligence: roleIntelligence as never
    })
  };
}

const request = {
  companyName: "Acme",
  companyLinkedinUrl: "https://linkedin.com/company/acme",
  requestedTitles: ["Software Engineer"],
  requestedLocations: ["New York"],
  maxResults: 25,
  budget: createAiBudget(),
  searchId: "search"
};

describe("DiscoverPeopleProviderOrchestrator", () => {
  it.each([3, 5])("does not call Apify when Bright has %i valid unique people", async (count) => {
    const { orchestrator, apify } = build(Array.from({ length: count }, (_, index) => profile(`b${index}`)));
    const result = await orchestrator.discover(request);
    expect(result.people).toHaveLength(count);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
    expect(result.diagnostics).toMatchObject({ brightValidUnique: count, apifyFallbackCalled: false });
  });

  it.each([0, 1, 2])("calls Apify once and preserves %i Bright people", async (count) => {
    const bright = Array.from({ length: count }, (_, index) => profile(`b${index}`));
    const { orchestrator, apify } = build(bright, [profile("a0"), profile("a1")]);
    const result = await orchestrator.discover(request);
    expect(apify.searchProfiles).toHaveBeenCalledTimes(1);
    expect(result.people.map((person) => person.sourceProfileId)).toEqual([
      ...bright.map((person) => person.sourceProfileId),
      "a0",
      "a1"
    ]);
  });

  it("deduplicates Apify against Bright and permanent identities while preserving Bright order", async () => {
    const { orchestrator } = build([profile("bright"), profile("existing")], [profile("bright"), profile("apify")]);
    const result = await orchestrator.discover({
      ...request,
      excluded: new PersonIdentitySet([{ sourceProfileId: "existing", linkedinUrl: "https://linkedin.com/in/existing" }])
    });
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["bright", "apify"]);
    expect(result.contributions.map((entry) => [entry.provider, entry.people.length])).toEqual([
      ["BRIGHTDATA_GOOGLE", 1],
      ["APIFY", 1]
    ]);
  });

  it("falls back to Apify after a Bright provider failure", async () => {
    const { orchestrator, apify } = build([], [profile("fallback")], new Error("private provider payload"));
    const result = await orchestrator.discover(request);
    expect(apify.searchProfiles).toHaveBeenCalledTimes(1);
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["fallback"]);
    expect(result.diagnostics).toMatchObject({ brightStatus: "FAILED", apifyFallbackCalled: true });
  });

  it("does not advance or exhaust Bright after a timeout and calls only company-targeted Apify", async () => {
    const { orchestrator, apify } = build([], [profile("fallback")], new BrightDataSearchError("TIMEOUT"));
    const result = await orchestrator.discover({ ...request, brightStartPage: 2, brightPagesFetched: 1 });

    expect(result.contributions.map((entry) => entry.provider)).toEqual(["APIFY"]);
    expect(result.diagnostics).toMatchObject({
      brightRequestCompleted: false,
      brightTimedOut: true,
      apifyFallbackCalled: true,
      apifyCompanyTargeted: true
    });
    expect(apify.searchProfiles).toHaveBeenCalledWith(expect.objectContaining({
      companyLinkedinUrl: "https://www.linkedin.com/company/acme",
      companyTargeting: { mode: "LINKEDIN_CURRENT_COMPANY", trusted: true }
    }));
  });

  it("retries the same Bright page after transient timeouts", async () => {
    const { orchestrator, bright } = build([], [profile("fallback")], new BrightDataSearchError("TIMEOUT"));

    await orchestrator.discover({ ...request, brightStartPage: 2, brightPagesFetched: 1 });
    await orchestrator.discover({ ...request, brightStartPage: 2, brightPagesFetched: 1 });

    expect(vi.mocked(bright.searchProfiles).mock.calls.map(([input]) => input.startPage)).toEqual([2, 2]);
  });

  it("resolves a missing company URL before Apify and sends current-company targeting", async () => {
    const { orchestrator, apify } = build([], [profile("fallback")]);
    const resolveCompanyLinkedinUrl = vi.fn(async () => "https://www.linkedin.com/company/confluent/");
    await orchestrator.discover({
      ...request,
      companyName: "Confluent, Inc.",
      companyLinkedinUrl: null,
      resolveCompanyLinkedinUrl
    });
    expect(resolveCompanyLinkedinUrl).toHaveBeenCalledTimes(1);
    expect(apify.searchProfiles).toHaveBeenCalledWith(expect.objectContaining({
      companyLinkedinUrl: "https://www.linkedin.com/company/confluent",
      companyTargeting: { mode: "LINKEDIN_CURRENT_COMPANY", trusted: true }
    }));
  });

  it("never calls Apify globally when company URL resolution fails", async () => {
    const { orchestrator, apify } = build([], [profile("must-not-run")]);
    await expect(orchestrator.discover({
      ...request,
      companyLinkedinUrl: null,
      resolveCompanyLinkedinUrl: vi.fn(async () => null)
    })).rejects.toThrow(/trusted LinkedIn company URL/i);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("preserves one or two Bright people when targeting cannot be resolved", async () => {
    const { orchestrator, apify } = build([profile("b0"), profile("b1")], [profile("must-not-run")]);
    const result = await orchestrator.discover({
      ...request,
      companyLinkedinUrl: null,
      resolveCompanyLinkedinUrl: vi.fn(async () => null)
    });
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["b0", "b1"]);
    expect(result.diagnostics.apifyFallbackCalled).toBe(false);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
});
