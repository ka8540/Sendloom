import { describe, expect, it, vi } from "vitest";
import { firecrawlFixture, firecrawlRow } from "./__test-utils__/firecrawl-fixture";
import { createFakePrisma } from "./__test-utils__/fake-prisma";
import { createAiBudget } from "./prospect-ai";
import { normalizeProfile } from "./apify-profile-search";
import { PersonIdentitySet } from "./discover-person-identity";
import { emptyPublicProfileDiagnostics } from "./public-profile-search-metadata";
import { buildFirecrawlPeopleQueryPlan } from "./public-people-query-builder";

const request = () => ({ companyName: "Apple", companyLinkedinUrl: "https://linkedin.com/company/apple", requestedTitles: ["Software Engineer"], requestedLocations: ["United States"], maxResults: 25, desiredCount: 10, searchId: "search", budget: createAiBudget() });
describe("Firecrawl-first provider chain", () => {
  it("persists all 25 validated people, allocates 10, preserves FIRECRAWL provenance, and stops paid work", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [Array.from({ length: 25 }, (_, index) => firecrawlRow(`valid-${index}`))] });
    const persist = vi.fn(async () => undefined);
    const result = await fixture.orchestrator.discover({ ...request(), onFirecrawlQuery: persist });
    expect(result.people).toHaveLength(10);
    expect(result.contributions[0]).toMatchObject({ provider: "FIRECRAWL", nextPage: 1, exhausted: false });
    expect(result.contributions[0].people).toHaveLength(25);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({ firecrawlPeoplePersisted: 25, firecrawlValidUnique: 25, continuationPending: false });
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
    expect(fixture.tavily.searchProfiles).not.toHaveBeenCalled();
    expect(fixture.bright.searchProfiles).not.toHaveBeenCalled();
    expect(fixture.runner.run).not.toHaveBeenCalled();
  });
  it("rejects wrong-role candidates through the existing role service", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("analyst", "Apple", "Data Analyst"), firecrawlRow("good")]], perAction: 1 });
    const result = await fixture.orchestrator.discover(request());
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["good"]);
    expect(result.diagnostics.firecrawl?.roleRejected).toBe(1);
  });
  it("a per-action cap preserves the next query and pending background work instead of switching providers", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("one")], [firecrawlRow("two")]] });
    const result = await fixture.orchestrator.discover(request());
    expect(result.diagnostics).toMatchObject({ firecrawlNextQueryIndex: 2, firecrawlQueriesFetched: 2, firecrawlExhausted: false, continuationPending: true });
    expect(fixture.tavily.searchProfiles).not.toHaveBeenCalled();
  });
  it("resumes the saved index and deduplicates earlier durable identities", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("same"), firecrawlRow("new")]], perAction: 1 });
    const result = await fixture.orchestrator.discover({ ...request(), firecrawlStartQueryIndex: 2, firecrawlQueriesFetched: 2, excluded: new PersonIdentitySet([{ sourceProfileId: "same" }]) });
    const body = JSON.parse((fixture.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.query).toContain('("Backend Engineer")');
    expect(body.query).not.toContain('("Software Engineer")');
    expect(result.diagnostics).toMatchObject({ firecrawlNextQueryIndex: 3, firecrawlQueriesFetched: 3, firecrawlExhausted: false });
    expect(result.people.map((person) => person.sourceProfileId)).toEqual(["new"]);
  });
  it("a spent parent deadline does not consume or exhaust a query and does not fall back", async () => {
    const fixture = firecrawlFixture(createFakePrisma());
    const result = await fixture.orchestrator.discover({ ...request(), firecrawlStartQueryIndex: 2, firecrawlQueriesFetched: 2, deadlineAtMs: Date.now() + 100 });
    expect(result.diagnostics).toMatchObject({ firecrawlNextQueryIndex: 2, firecrawlQueriesFetched: 2, firecrawlExhausted: false, continuationPending: true });
    expect(fixture.fetcher).not.toHaveBeenCalled();
    expect(fixture.tavily.searchProfiles).not.toHaveBeenCalled();
  });
  it("marks exhaustion only after all five query entries succeed, then allows Tavily and Apify", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { perAction: 5 });
    const result = await fixture.orchestrator.discover(request());
    expect(result.diagnostics).toMatchObject({ firecrawlNextQueryIndex: 5, firecrawlQueriesFetched: 5, firecrawlExhausted: true, continuationPending: false });
    expect(fixture.tavily.searchProfiles).toHaveBeenCalled();
    expect(fixture.runner.run).toHaveBeenCalledTimes(1);
    expect(fixture.fetcher.mock.invocationCallOrder[0]).toBeLessThan((fixture.tavily.searchProfiles as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });
  it("continues successful rejected/empty queries and keeps partial exhausted people for DB-first consumption", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("wrong", "Other Company")], [], [firecrawlRow("one")]], perAction: 5, maxQueries: 3 });
    const result = await fixture.orchestrator.discover(request());
    expect(fixture.fetcher).toHaveBeenCalledTimes(3);
    expect(result.diagnostics).toMatchObject({ firecrawlExhausted: true, firecrawlValidUnique: 1, continuationPending: false });
    expect(fixture.tavily.searchProfiles).not.toHaveBeenCalled();
    // Next explicit opportunity is downstream after this person is consumed.
    await fixture.orchestrator.discover({ ...request(), firecrawlStartQueryIndex: 3, firecrawlExhausted: true });
    expect(fixture.fetcher).toHaveBeenCalledTimes(3);
    expect(fixture.tavily.searchProfiles).toHaveBeenCalled();
  });
  it.each([
    [new Response("credential body", { status: 401 }), "FIRECRAWL_AUTH_ERROR"],
    [new Response("limited", { status: 429 }), "FIRECRAWL_RATE_LIMIT"],
    [new DOMException("Timed out", "TimeoutError"), "FIRECRAWL_TIMEOUT"],
    [Response.json({ success: true, data: { web: "invalid" } }), "FIRECRAWL_MALFORMED_RESPONSE"]
  ])("falls back on a safe availability failure and leaves Firecrawl recoverable: %s", async (error, event) => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [error] });
    const result = await fixture.orchestrator.discover(request());
    expect(result.diagnostics).toMatchObject({ firecrawlFailureEvent: event, firecrawlNextQueryIndex: 0, firecrawlQueriesFetched: 0, firecrawlExhausted: false });
    expect(fixture.tavily.searchProfiles).toHaveBeenCalled();
  });
  it("deduplicates across Firecrawl and a failure-fallback Tavily query", async () => {
    const profiles = [normalizeProfile({ id: "same", fullName: "Jane Doe", headline: "Software Engineer", currentCompany: "Apple", location: "United States", linkedinUrl: "https://www.linkedin.com/in/same" })!];
    const tavily = { configured: true, searchProfiles: vi.fn(async () => ({ profiles, diagnostics: { ...emptyPublicProfileDiagnostics(), rawTavilyResults: 1, creditsUsed: 1 } })) };
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("same")], new Response("failure", { status: 500 })], tavily });
    const result = await fixture.orchestrator.discover(request());
    expect(result.people).toHaveLength(1);
    expect(result.diagnostics.tavily?.duplicateRejected).toBeGreaterThan(0);
    expect(result.contributions.flatMap((contribution) => contribution.people)).toHaveLength(1);
  });
  it("does not treat a failed durable write as provider failure or call downstream", async () => {
    const fixture = firecrawlFixture(createFakePrisma(), { pages: [[firecrawlRow("one")]] });
    await expect(fixture.orchestrator.discover({ ...request(), onFirecrawlQuery: async () => { throw new Error("Database unavailable"); } })).rejects.toThrow("Database unavailable");
    expect(fixture.tavily.searchProfiles).not.toHaveBeenCalled();
  });
  it("legacy provider batches skip Firecrawl without changing its zero continuation defaults", async () => {
    const fixture = firecrawlFixture(createFakePrisma());
    const result = await fixture.orchestrator.discover({ ...request(), skipFirecrawl: true });
    expect(fixture.fetcher).not.toHaveBeenCalled();
    expect(fixture.tavily.searchProfiles).toHaveBeenCalled();
    expect(result.diagnostics).toMatchObject({ firecrawlNextQueryIndex: 0, firecrawlQueriesFetched: 0, firecrawlExhausted: false });
  });
});

describe("Firecrawl bounded query plan", () => {
  it("keeps exact title first, then authorized variants, using shared company aliases and safe quoting", () => {
    const plan = buildFirecrawlPeopleQueryPlan({ companyName: 'Acme Inc.', providerTitles: ["Recruiter", "Talent Acquisition Specialist", "Recruiter"], locations: ["United States"], maxQueries: 5 });
    expect(plan).toEqual(['site:linkedin.com/in ("Acme Inc." OR "Acme") ("Recruiter") ("United States")', 'site:linkedin.com/in ("Acme Inc." OR "Acme") ("Talent Acquisition Specialist") ("United States")']);
  });
  it("bounds queries, removes control characters/operators from quoted inputs, and retains location", () => {
    const plan = buildFirecrawlPeopleQueryPlan({ companyName: 'Acme"\nCorp', providerTitles: ["Recruiter", "Sourcer"], locations: ['United "States"'], maxQueries: 1 });
    expect(plan).toHaveLength(1);
    expect(plan[0]).not.toContain("\n");
    expect(plan[0]).toContain('("United States")');
  });
});
