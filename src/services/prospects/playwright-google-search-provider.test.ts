import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, Page, Route } from "playwright-core";
import { PlaywrightGoogleSearchProvider, extractGoogleSerpPeople } from "./playwright-google-search-provider";
import { buildPublicPeopleRoleUnionQuery, MAX_PUBLIC_ROLE_TERMS } from "./public-people-query-builder";
import { PublicSearchDiscoveryProvider, publicCounters } from "./public-profile-search";
import { discoverProfiles } from "./prospect-discovery-provider";
import { PersonIdentitySet } from "./discover-person-identity";
import { YouSearchProvider, createConfiguredWebSearchProvider } from "./web-search-provider";
import { createConfiguredEmailFormatSearchProvider } from "./email-format-discovery-service";
import { getEnv } from "@/lib/env";

const titles = ["Software Engineer", "Software Developer", "Backend Software Engineer", "Frontend Software Engineer", "Application Developer"];
const input = { companyName: "Abacus Insights", jobTitles: titles, locations: ["United States"], maxResults: 25 };
const query = buildPublicPeopleRoleUnionQuery({ companyName: input.companyName, providerTitles: titles })!;
const row = (id: string, location: string | null = "Dallas, Texas", title = "Software Engineer at Abacus Insights") => ({
  title: `Jane Doe - ${title} | LinkedIn`, url: `https://linkedin.com/in/${id}`,
  snippet: [title, location].filter(Boolean).join(" · ")
});

function fakeBrowser(rows = [row("jane-doe")]) {
  let navigatedUrl = "";
  const frame = {};
  const page = {
    mainFrame: () => frame,
    goto: vi.fn(async (url: string) => { navigatedUrl = url; return { ok: () => true }; }),
    url: () => navigatedUrl,
    locator: vi.fn(() => ({ count: async () => 0, first: () => ({ waitFor: async () => undefined }) })),
    evaluate: vi.fn(async () => rows)
  };
  const context = { newPage: vi.fn(async () => page), route: vi.fn(async (_pattern: string, _handler: (route: Route) => Promise<void>) => undefined) };
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
  const launch = vi.fn(async () => browser as unknown as Browser);
  return { page, context, browser, launch, provider: new PlaywrightGoogleSearchProvider(launch), frame };
}

afterEach(() => vi.restoreAllMocks());

describe("bounded provider-plan OR query", () => {
  it("keeps the exact role first and puts existing aliases in the single OR clause", () => {
    expect(query).toBe('site:linkedin.com/in "Abacus Insights" ("Software Engineer" OR "Software Developer" OR "Backend Software Engineer" OR "Frontend Software Engineer" OR "Application Developer")');
    expect(query).not.toContain("United States");
  });
  it("caps the ranked plan at five terms, deduplicates and never invents aliases", () => {
    const plan = [...titles, "Senior Software Engineer", "Staff Software Engineer"];
    const result = buildPublicPeopleRoleUnionQuery({ companyName: "Abacus Insights", providerTitles: [plan[0], plan[0].toLowerCase(), ...plan.slice(1)] })!;
    expect(result.match(/ OR /g)).toHaveLength(MAX_PUBLIC_ROLE_TERMS - 1);
    expect(result).not.toMatch(/Senior|Staff|Recruiter|Data Engineer/);
    expect(buildPublicPeopleRoleUnionQuery({ companyName: "Acme", providerTitles: ["Human Resources", "HR Generalist"] }))
      .toBe('site:linkedin.com/in "Acme" ("Human Resources" OR "HR Generalist")');
  });
  it("uses existing phrase escaping, bounds query size and handles an empty plan", () => {
    expect(buildPublicPeopleRoleUnionQuery({ companyName: ' A " B\\ C\n', providerTitles: ['  Data   Engineer ', 'Data "Platform" Engineer'] }))
      .toBe('site:linkedin.com/in "A B C" ("Data Engineer" OR "Data Platform Engineer")');
    expect(buildPublicPeopleRoleUnionQuery({ companyName: "Acme", providerTitles: [] })).toBeNull();
    expect(buildPublicPeopleRoleUnionQuery({ companyName: "A".repeat(500), providerTitles: Array.from({ length: 50 }, (_, i) => `Role ${i} ${"x".repeat(500)}`) })!.length).toBeLessThan(1500);
  });
});

describe("one Google navigation through public discovery", () => {
  it("five role aliases and multiple people produce one navigation, no You.com or Apify calls", async () => {
    const fixture = fakeBrowser([row("jane"), row("john", "Seattle, Washington"), row("former", "Dallas, Texas", "Former Software Engineer at Abacus Insights"),
      row("london", "London, United Kingdom"), row("unknown", null), { ...row("jane"), url: "https://www.linkedin.com/in/jane/?trk=search" }]);
    const apify = { searchProfiles: vi.fn() };
    const you = vi.spyOn(YouSearchProvider.prototype, "search");
    const results = await discoverProfiles(input, { mode: "public_search", apify,
      publicProvider: new PublicSearchDiscoveryProvider(fixture.provider), target: 10, validate: async profiles => profiles });
    expect(fixture.launch).toHaveBeenCalledTimes(1);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
    const url = new URL(fixture.page.goto.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://www.google.com/search");
    expect(url.searchParams.get("q")).toBe(query);
    expect(results.profiles.map(p => p.sourceProfileId)).toEqual(["jane", "john", "unknown"]);
    expect(results.profiles.find(p => p.sourceProfileId === "unknown")?.location).toBeNull();
    expect(results.profiles[0]).toMatchObject({ location: "Dallas, Texas", state: "Texas", country: "United States" });
    expect(apify.searchProfiles).not.toHaveBeenCalled(); expect(you).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });
  it("does not navigate again when one SERP provides fewer people than the target", async () => {
    const fixture = fakeBrowser();
    const d = publicCounters();
    const result = await new PublicSearchDiscoveryProvider(fixture.provider).searchProfiles(input, {
      target: 10, validate: async p => p, denied: new PersonIdentitySet(), diagnostics: d
    });
    expect(result.profiles).toHaveLength(1);
    expect(d).toMatchObject({ publicSearchQueries: 1, publicSearchPages: 1 });
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
    expect(await fixture.provider.search(query, { page: 2 })).toEqual([]);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });
  it("keeps same-name/different-URL people and excludes granted identities on Add More", async () => {
    const fixture = fakeBrowser([row("old"), row("new-a"), row("new-b")]);
    const result = await new PublicSearchDiscoveryProvider(fixture.provider).searchProfiles(input, {
      target: 10, validate: async p => p, denied: new PersonIdentitySet(), diagnostics: publicCounters(),
      excluded: new PersonIdentitySet([{ linkedinUrl: "https://www.linkedin.com/in/old?trk=x" }])
    });
    expect(result.profiles.map(p => p.sourceProfileId)).toEqual(["new-a", "new-b"]);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });
  it("keeps the extracted public-person projection to name, URL and location", async () => {
    const fixture = fakeBrowser([row("jane", "Lynn, Massachusetts, United States")]);
    const [candidate] = await extractGoogleSerpPeople(fixture.page as unknown as Page);
    expect(candidate.person).toEqual({ name: "Jane Doe", linkedinUrl: "https://linkedin.com/in/jane", location: "Lynn, Massachusetts, United States" });
    expect(candidate.evidence.title).toContain("Software Engineer at Abacus Insights");
  });
  it("rejects non-person URLs even inside a Google domain-restricted search", async () => {
    const fixture = fakeBrowser(["company/acme", "jobs/123", "posts/123", "feed/", "school/acme"].map(path => ({ ...row("unused"), url: `https://linkedin.com/${path}` })));
    expect(await fixture.provider.search(query)).toEqual([]);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });
  it("decodes Google redirect URLs without following them", async () => {
    const fixture = fakeBrowser([{ ...row("jane"), url: "https://www.google.com/url?q=https%3A%2F%2Flinkedin.com%2Fin%2Fjane%3Ftrk%3Dgoogle" }]);
    expect((await fixture.provider.search(query))[0].url).toBe("https://linkedin.com/in/jane");
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });
  it("closes the browser and returns a safe error when Google blocks or fails", async () => {
    const fixture = fakeBrowser();
    fixture.page.goto.mockRejectedValue(new Error("raw HTML, Jane Doe, private query"));
    await expect(fixture.provider.search(query)).rejects.toThrow("Google people search is temporarily unavailable.");
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
  });
  it("blocks LinkedIn requests and any navigation after the initial Google document", async () => {
    const fixture = fakeBrowser();
    await fixture.provider.search(query);
    const handler = fixture.context.route.mock.calls[0][1];
    const destination = fixture.page.goto.mock.calls[0][0];
    const request = (url: string) => {
      const route = { request: () => ({ url: () => url, frame: () => fixture.frame,
        isNavigationRequest: () => true, resourceType: () => "document" }), abort: vi.fn(), continue: vi.fn() };
      return route;
    };
    const first = request(destination); await handler(first as unknown as Route); expect(first.continue).toHaveBeenCalledTimes(1);
    const second = request(destination); await handler(second as unknown as Route); expect(second.abort).toHaveBeenCalledTimes(1);
    const linkedin = request("https://linkedin.com/in/jane"); await handler(linkedin as unknown as Route); expect(linkedin.abort).toHaveBeenCalledTimes(1);
  });
  it("selects Google from the configured factory but prevents extra email-format SERP navigation", () => {
    const config = getEnv(); const previous = config.WEB_SEARCH_PROVIDER;
    config.WEB_SEARCH_PROVIDER = "playwright_google";
    try {
      expect(createConfiguredWebSearchProvider()).toBeInstanceOf(PlaywrightGoogleSearchProvider);
      expect(createConfiguredEmailFormatSearchProvider()).toBeNull();
    } finally { config.WEB_SEARCH_PROVIDER = previous; }
  });
});
