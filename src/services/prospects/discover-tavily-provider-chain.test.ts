import { describe, expect, it, vi } from "vitest";

import { normalizeProfile, type ApifyProfileSearchService, type NormalizedProfile } from "./apify-profile-search";
import { BrightDataSearchError } from "./brightdata-google-search-provider";
import type { BrightProfileSearchProvider } from "./brightdata-public-profile-search";
import { DiscoverPeopleProviderOrchestrator } from "./discover-people-provider-orchestrator";
import { createAiBudget } from "./prospect-ai";
import type { TavilyProfileDiagnostics, TavilyProfileSearchProvider } from "./tavily-public-profile-search";
import { TavilySearchError } from "./tavily-search-provider";

function person(id: string): NormalizedProfile {
  return normalizeProfile({
    id,
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    fullName: `Jane ${id}`,
    currentTitle: "Software Engineer",
    headline: "Software Engineer at Acme",
    currentCompany: "Acme",
    location: "United States"
  })!;
}

function counts(profiles: NormalizedProfile[], raw = profiles.length): TavilyProfileDiagnostics {
  return {
    rawTavilyResults: raw,
    linkedInCandidates: raw,
    currentEmploymentAccepted: profiles.length,
    formerEmployeeRejected: 0,
    companyContradictionRejected: 0,
    companyInsufficientRejected: Math.max(0, raw - profiles.length),
    locationAccepted: profiles.length,
    locationMissing: 0,
    locationContradictionRejected: 0,
    roleRejected: 0,
    duplicateRejected: 0,
    creditsUsed: 1
  };
}

function setup(
  tavilyPages: Array<{ profiles?: NormalizedProfile[]; raw?: number; error?: Error }>,
  options: { maxQueries?: number; perAction?: number; brightProfiles?: NormalizedProfile[]; brightError?: Error } = {}
) {
  let index = 0;
  const tavily: TavilyProfileSearchProvider = {
    configured: true,
    searchProfiles: vi.fn(async () => {
      const page = tavilyPages[index++] ?? { profiles: [], raw: 0 };
      if (page.error) throw page.error;
      const profiles = page.profiles ?? [];
      return { profiles, diagnostics: counts(profiles, page.raw) };
    })
  };
  const brightProfiles = options.brightProfiles ?? [];
  const bright: BrightProfileSearchProvider = {
    configured: true,
    searchProfiles: vi.fn(async (input) => {
      if (options.brightError) throw options.brightError;
      return {
        profiles: brightProfiles,
        nextPage: (input.startPage ?? 1) + 1,
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
      profiles: [], runId: "run", datasetId: "dataset", totalFound: 0,
      diagnostics: { itemsReturned: 0, parsedCandidates: 0, rejectedBySchema: 0, duplicateItems: 0, companyMatched: 0, rejectedByCompany: 0 }
    }))
  } as unknown as ApifyProfileSearchService;
  const roleClassifier = {
    classify: vi.fn(async (titles: string[]) => new Map(titles.map((title) => [title.toLowerCase(), { category: "SOFTWARE_ENGINEERING" }])))
  };
  const roleIntelligence = {
    enabled: true,
    buildProviderTitlePlan: vi.fn(async () => [
      "Software Engineer", "Software Developer", "Backend Engineer", "Full Stack Engineer", "Systems Engineer"
    ]),
    filterAndRankPeople: vi.fn(async ({ people }: { people: NormalizedProfile[] }) => people)
  };
  return {
    tavily,
    bright,
    apify,
    orchestrator: new DiscoverPeopleProviderOrchestrator({
      firecrawl: { configured: false, searchProfiles: vi.fn(async () => { throw new Error("Disabled Firecrawl must not run"); }) },
      tavily,
      bright,
      apify,
      roleClassifier: roleClassifier as never,
      roleIntelligence: roleIntelligence as never,
      tavilyMaxQueries: options.maxQueries ?? 5,
      tavilyMaxQueriesPerAction: options.perAction ?? 5
    })
  };
}

const request = {
  companyName: "Acme",
  companyLinkedinUrl: "https://linkedin.com/company/acme",
  requestedTitles: ["Software Engineer"],
  requestedLocations: ["United States"],
  maxResults: 20,
  desiredCount: 10,
  budget: createAiBudget(),
  searchId: "search"
};

describe("Tavily provider continuation after Firecrawl fallback", () => {
  it("persists all first-query people and never calls Bright after filling the target", async () => {
    const found = Array.from({ length: 14 }, (_, index) => person(`first-${index}`));
    const onTavilyQuery = vi.fn(async () => undefined);
    const { orchestrator, tavily, bright } = setup([{ profiles: found }]);
    const result = await orchestrator.discover({ ...request, onTavilyQuery });
    expect(tavily.searchProfiles).toHaveBeenCalledTimes(1);
    expect(result.people).toHaveLength(10);
    expect(result.contributions[0].people).toHaveLength(14);
    expect(onTavilyQuery).toHaveBeenCalledWith(expect.objectContaining({ people: expect.arrayContaining(found.map((entry) => expect.objectContaining({ sourceProfileId: entry.sourceProfileId }))) }));
    expect(result.diagnostics.tavilyPeoplePersisted).toBe(14);
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it("continues deterministic queries until unique Tavily people fill the target", async () => {
    const onTavilyQuery = vi.fn(async () => undefined);
    const { orchestrator, tavily, bright } = setup([
      { profiles: Array.from({ length: 4 }, (_, index) => person(`one-${index}`)), raw: 20 },
      { profiles: Array.from({ length: 5 }, (_, index) => person(`two-${index}`)), raw: 20 },
      { profiles: Array.from({ length: 6 }, (_, index) => person(`three-${index}`)), raw: 20 }
    ]);
    const result = await orchestrator.discover({ ...request, onTavilyQuery });
    expect(tavily.searchProfiles).toHaveBeenCalledTimes(3);
    expect(result.people).toHaveLength(10);
    expect(result.contributions.flatMap((entry) => entry.people)).toHaveLength(15);
    expect(onTavilyQuery).toHaveBeenCalledTimes(3);
    expect(result.diagnostics).toMatchObject({ tavilyValidUnique: 15, tavilyNextQueryIndex: 3, tavilyQueriesFetched: 3 });
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it("deduplicates the same LinkedIn identity across queries", async () => {
    const { orchestrator } = setup([
      { profiles: [person("same"), person("one")] },
      { profiles: [person("same"), person("two")] }
    ], { perAction: 2 });
    const result = await orchestrator.discover(request);
    expect(result.diagnostics.tavilyValidUnique).toBe(3);
    expect(result.diagnostics.tavily?.duplicateRejected).toBe(1);
  });

  it("continues after raw results are all rejected", async () => {
    const { orchestrator, tavily, bright } = setup([
      { profiles: [], raw: 20 },
      { profiles: [person("accepted")], raw: 20 }
    ], { perAction: 2 });
    const result = await orchestrator.discover(request);
    expect(tavily.searchProfiles).toHaveBeenCalledTimes(2);
    expect(result.people.map((entry) => entry.sourceProfileId)).toEqual(["accepted"]);
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it("stops at the per-action cap without exhausting Tavily or calling Bright", async () => {
    const found = Array.from({ length: 7 }, (_, index) => person(`cap-${index}`));
    const { orchestrator, bright } = setup([{ profiles: found }], { perAction: 1 });
    const result = await orchestrator.discover(request);
    expect(result.people).toHaveLength(7);
    expect(result.diagnostics).toMatchObject({ tavilyExhausted: false, tavilyNextQueryIndex: 1 });
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it("uses Bright only after true successful query-plan exhaustion with zero valid people", async () => {
    const { orchestrator, bright } = setup([{ profiles: [], raw: 0 }, { profiles: [], raw: 0 }], {
      maxQueries: 2,
      brightProfiles: [person("bright")]
    });
    const result = await orchestrator.discover(request);
    expect(result.diagnostics.tavilyExhausted).toBe(true);
    expect(bright.searchProfiles).toHaveBeenCalledTimes(1);
    expect(result.people.map((entry) => entry.sourceProfileId)).toEqual(["bright"]);
  });

  it("does not call Bright when the final Tavily query returns people", async () => {
    const found = Array.from({ length: 5 }, (_, index) => person(`final-${index}`));
    const { orchestrator, bright } = setup([{ profiles: [], raw: 20 }, { profiles: found, raw: 20 }], { maxQueries: 2 });
    const result = await orchestrator.discover(request);
    expect(result.diagnostics.tavilyExhausted).toBe(true);
    expect(result.people).toHaveLength(5);
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it.each([1, 3, 6, 9])("never treats %i valid Tavily people as a Bright fallback threshold", async (amount) => {
    const { orchestrator, bright } = setup([
      { profiles: Array.from({ length: amount }, (_, index) => person(`partial-${index}`)) }
    ], { perAction: 1 });
    const result = await orchestrator.discover(request);
    expect(result.people).toHaveLength(amount);
    expect(result.diagnostics.tavilyExhausted).toBe(false);
    expect(bright.searchProfiles).not.toHaveBeenCalled();
  });

  it.each([
    ["TIMEOUT", "TAVILY_TIMEOUT"],
    ["AUTHENTICATION", "TAVILY_AUTH_ERROR"],
    ["RATE_LIMIT", "TAVILY_RATE_LIMIT"],
    ["USAGE_LIMIT", "TAVILY_USAGE_LIMIT"],
    ["MALFORMED_RESPONSE", "TAVILY_MALFORMED_RESPONSE"]
  ] as const)("temporarily falls back to Bright on %s without advancing continuation", async (kind, event) => {
    const { orchestrator, bright } = setup([{ error: new TavilySearchError(kind) }], { brightProfiles: [person("bright")] });
    const result = await orchestrator.discover({ ...request, tavilyStartQueryIndex: 2, tavilyQueriesFetched: 2 });
    expect(bright.searchProfiles).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({
      tavilyFailureEvent: event,
      tavilyNextQueryIndex: 2,
      tavilyQueriesFetched: 2,
      tavilyExhausted: false
    });
  });

  it("retries a failed query index and never repeats a successful index supplied by continuation", async () => {
    const failed = setup([{ error: new TavilySearchError("TIMEOUT") }]);
    await failed.orchestrator.discover({ ...request, tavilyStartQueryIndex: 2, tavilyQueriesFetched: 2 });
    const retried = setup([{ profiles: [person("retry")] }], { perAction: 1 });
    const result = await retried.orchestrator.discover({ ...request, tavilyStartQueryIndex: 2, tavilyQueriesFetched: 2 });
    const firstCall = vi.mocked(retried.tavily.searchProfiles).mock.calls[0][0];
    expect(firstCall.query).toContain('("Software Developer")');
    expect(result.diagnostics).toMatchObject({ tavilyNextQueryIndex: 3, tavilyQueriesFetched: 3 });
  });

  it("never logs Tavily continuation state as Bright state after a failed Bright page", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { orchestrator, bright } = setup(
        Array.from({ length: 6 }, () => ({ profiles: [], raw: 0 })),
        {
          maxQueries: 6,
          perAction: 6,
          brightError: new BrightDataSearchError("MALFORMED_RESPONSE", { status: 200, stage: "ORGANIC_ARRAY_MISSING" })
        }
      );
      const result = await orchestrator.discover(request);
      expect(bright.searchProfiles).toHaveBeenCalledTimes(1);
      expect(result.contributions.filter((entry) => entry.provider === "TAVILY").at(-1))
        .toMatchObject({ nextPage: 6, exhausted: true });
      expect(result.contributions.some((entry) => entry.provider === "BRIGHTDATA_GOOGLE")).toBe(false);
      const events = info.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const logged = events.find((entry) => entry.event === "DISCOVER_BRIGHTDATA_RESULTS");
      expect(logged).toMatchObject({
        brightStartPage: 1,
        brightPagesAttempted: 1,
        brightPagesSucceeded: 0,
        brightNextPage: 1,
        brightExhausted: false
      });
      expect(result.diagnostics).toMatchObject({
        brightFailureEvent: "BRIGHT_MALFORMED_RESPONSE",
        brightNextPage: 1,
        brightExhausted: false
      });
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("does not escalate after parent deadline", async () => {
    const { orchestrator, tavily, bright, apify } = setup([{ profiles: [person("nope")] }]);
    await orchestrator.discover({ ...request, deadlineAtMs: Date.now() + 1_000 });
    expect(tavily.searchProfiles).not.toHaveBeenCalled();
    expect(bright.searchProfiles).not.toHaveBeenCalled();
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
});
