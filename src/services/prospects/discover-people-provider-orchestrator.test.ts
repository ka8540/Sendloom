import { describe, expect, it, vi } from "vitest";

import { normalizeProfile, type ApifyProfileSearchService, type NormalizedProfile } from "./apify-profile-search";
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
});
