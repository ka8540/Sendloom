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

function buildPages(
  pages: Array<{
    profiles?: NormalizedProfile[];
    raw?: number;
    exhausted?: boolean;
    error?: Error;
    enrichmentCalls?: number;
  }>,
  apifyProfiles: NormalizedProfile[] = [],
  brightMaxPages = 10
) {
  let index = 0;
  const bright: BrightProfileSearchProvider = {
    configured: true,
    searchProfiles: vi.fn(async (input) => {
      const page = pages[index++] ?? { profiles: [], raw: 0, exhausted: true };
      if (page.error) throw page.error;
      const profiles = page.profiles ?? [];
      return {
        profiles,
        nextPage: (input.startPage ?? 1) + 1,
        exhausted: page.exhausted ?? false,
        diagnostics: {
          rawBrightResults: page.raw ?? profiles.length,
          linkedInCandidates: page.raw ?? profiles.length,
          currentEmploymentAccepted: profiles.length,
          formerEmployeeRejected: 0,
          companyContradictionRejected: 0,
          companyInsufficientRejected: Math.max(0, (page.raw ?? profiles.length) - profiles.length),
          locationAccepted: profiles.length,
          locationMissing: 0,
          locationContradictionRejected: 0,
          duplicateRejected: 0,
          enrichmentCalls: page.enrichmentCalls ?? 0
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
      roleIntelligence: roleIntelligence as never,
      brightMaxPages
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
  it("collects across Bright pages until the desired count instead of stopping at the fallback threshold", async () => {
    const { orchestrator, bright, apify } = buildPages([
      { profiles: Array.from({ length: 6 }, (_, index) => profile(`p1-${index}`)), raw: 10 },
      { profiles: Array.from({ length: 5 }, (_, index) => profile(`p2-${index}`)), raw: 10 }
    ]);

    const result = await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(vi.mocked(bright.searchProfiles).mock.calls.map(([input]) => input.startPage)).toEqual([1, 2]);
    expect(result.people).toHaveLength(10);
    expect(result.contributions.filter((entry) => entry.provider === "BRIGHTDATA_GOOGLE").flatMap((entry) => entry.people)).toHaveLength(11);
    expect(result.diagnostics).toMatchObject({
      brightPagesAttempted: 2,
      brightPagesSucceeded: 2,
      brightValidUnique: 11,
      desiredCount: 10,
      stopReason: "TARGET_REACHED"
    });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("returns all Bright people at the configured page cap without using Apify when at least three exist", async () => {
    const { orchestrator, bright, apify } = buildPages([
      { profiles: Array.from({ length: 4 }, (_, index) => profile(`cap1-${index}`)), raw: 10 },
      { profiles: Array.from({ length: 3 }, (_, index) => profile(`cap2-${index}`)), raw: 10 },
      { profiles: Array.from({ length: 2 }, (_, index) => profile(`cap3-${index}`)), raw: 10 }
    ], [], 3);

    const result = await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(vi.mocked(bright.searchProfiles)).toHaveBeenCalledTimes(3);
    expect(result.people).toHaveLength(9);
    expect(result.diagnostics.stopReason).toBe("MAX_PAGES");
    expect(result.contributions.at(-1)).toMatchObject({ provider: "BRIGHTDATA_GOOGLE", nextPage: 4, exhausted: true });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("retains two Bright people through an empty page then calls targeted Apify once", async () => {
    const { orchestrator, bright, apify } = buildPages([
      { profiles: [profile("partial-1")], raw: 10 },
      { profiles: [profile("partial-2")], raw: 10 },
      { profiles: [], raw: 0, exhausted: true }
    ], [profile("apify")]);

    const result = await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(vi.mocked(bright.searchProfiles)).toHaveBeenCalledTimes(3);
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["partial-1", "partial-2", "apify"]);
    expect(result.diagnostics.stopReason).toBe("EMPTY_PAGE");
    expect(apify.searchProfiles).toHaveBeenCalledTimes(1);
    expect(apify.searchProfiles).toHaveBeenCalledWith(expect.objectContaining({
      companyTargeting: { mode: "LINKEDIN_CURRENT_COMPANY", trusted: true }
    }));
  });

  it("continues after a page whose raw rows are all rejected", async () => {
    const { orchestrator, bright, apify } = buildPages([
      { profiles: [], raw: 10 },
      { profiles: Array.from({ length: 5 }, (_, index) => profile(`accepted-${index}`)), raw: 10, exhausted: true }
    ]);

    const result = await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(vi.mocked(bright.searchProfiles).mock.calls.map(([input]) => input.startPage)).toEqual([1, 2]);
    expect(result.people).toHaveLength(5);
    expect(result.diagnostics.bright!.rawBrightResults).toBe(20);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("keeps successful page-one state when page two times out", async () => {
    const onBrightPage = vi.fn(async () => undefined);
    const { orchestrator, bright, apify } = buildPages([
      { profiles: Array.from({ length: 4 }, (_, index) => profile(`timeout-${index}`)), raw: 10 },
      { error: new BrightDataSearchError("TIMEOUT") }
    ]);

    const result = await orchestrator.discover({ ...request, desiredCount: 10, onBrightPage });

    expect(vi.mocked(bright.searchProfiles)).toHaveBeenCalledTimes(2);
    expect(onBrightPage).toHaveBeenCalledTimes(1);
    expect(onBrightPage).toHaveBeenCalledWith(expect.objectContaining({ nextPage: 2, pagesFetched: 1, exhausted: false }));
    expect(result.people).toHaveLength(4);
    expect(result.contributions).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({ stopReason: "TIMEOUT", brightPagesAttempted: 2, brightPagesSucceeded: 1 });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("does not count canonical LinkedIn duplicates across Bright pages toward the target", async () => {
    const firstPage = Array.from({ length: 6 }, (_, index) => profile(`dedupe-${index}`));
    const secondPage = [
      normalizeProfile({
        id: "replacement-id",
        linkedinUrl: "https://www.linkedin.com/in/dedupe-5/",
        fullName: "Jane duplicate",
        currentTitle: "Software Engineer",
        currentCompany: "Acme",
        location: "New York, New York, United States"
      })!,
      ...Array.from({ length: 4 }, (_, index) => profile(`dedupe-${index + 6}`))
    ];
    const { orchestrator, apify } = buildPages([
      { profiles: firstPage, raw: 10 },
      { profiles: secondPage, raw: 10 }
    ]);

    const result = await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(result.people).toHaveLength(10);
    expect(result.diagnostics.brightValidUnique).toBe(10);
    expect(result.diagnostics.bright!.duplicateRejected).toBe(1);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });

  it("does not start another external call when the parent deadline is near", async () => {
    const { orchestrator, bright, apify } = buildPages([
      { profiles: [profile("must-not-run")], raw: 10 }
    ]);

    const result = await orchestrator.discover({
      ...request,
      desiredCount: 10,
      deadlineAtMs: Date.now() + 1_000
    });

    expect(bright.searchProfiles).not.toHaveBeenCalled();
    expect(apify.searchProfiles).not.toHaveBeenCalled();
    expect(result.diagnostics.stopReason).toBe("PARENT_DEADLINE");
  });

  it("shares the bounded location-enrichment budget across Bright pages", async () => {
    const { orchestrator, bright } = buildPages([
      { profiles: Array.from({ length: 6 }, (_, index) => profile(`enrich-1-${index}`)), raw: 10, enrichmentCalls: 2 },
      { profiles: Array.from({ length: 4 }, (_, index) => profile(`enrich-2-${index}`)), raw: 10 }
    ]);

    await orchestrator.discover({ ...request, desiredCount: 10 });

    expect(vi.mocked(bright.searchProfiles).mock.calls.map(([input]) => input.locationEnrichmentLimit)).toEqual([2, 0]);
  });

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
