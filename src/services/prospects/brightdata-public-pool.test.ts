import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createFakePrisma } from './__test-utils__/fake-prisma';
import { DiscoverSearchCacheService, type DiscoverCacheLock, type DiscoverCacheExpansionState, type GetOrRefreshParams, type ResolvedDataset } from './discover-cache-service';
import { normalizeDiscoverPersonNames } from './discover-person-name-normalization';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { PublicSearchDiscoveryProvider, publicCounters } from './public-profile-search';
import { PersonIdentitySet } from './discover-person-identity';
import { publicLocationEvidence, requestedCountryFallback } from './public-profile-location';
import { publicPoolRoleMatches } from './public-pool-eligibility';

const row = (id: number | string, snippet = 'Boston, Massachusetts, United States') => ({
  title: 'Jane Doe - Software Engineer at Example | LinkedIn', url: `https://www.linkedin.com/in/person-${id}`, snippet
});
const format = { emailDomain: 'example.org', emailDomainConfidence: 'HIGH', emailDomainEvidence: null,
  emailPattern: 'first.last', patternConfidence: 'HIGH', patternEvidence: null, emailFormatReason: null };
const person = (id: number) => ({ ...parseLinkedInSearchResult(row(id))!, positionCategory: 'SOFTWARE_ENGINEERING',
  inferredEmail: null, emailStatus: 'UNAVAILABLE', emailConfidence: 'UNAVAILABLE', emailPattern: null, emailSource: null });
function lock(): DiscoverCacheLock {
  let held = false;
  return { acquire: async () => { if (held) return null; held = true; return 'token'; }, release: async () => { held = false; } };
}
function setup() {
  const db = createFakePrisma();
  const cache = new DiscoverSearchCacheService({ prisma: db as unknown as PrismaClient, lock: lock(), pollIntervalMs: 1, waitTimeoutMs: 1000 });
  const provider = vi.fn(async (state: DiscoverCacheExpansionState | null): Promise<ResolvedDataset> => {
    const page = state?.providerNextPage ?? 1;
    const names = await normalizeDiscoverPersonNames(Array.from({ length: 10 }, (_, i) => person((page - 1) * 10 + i)));
    // Cache records contain only their defined public fields.
    const people = names.map(({ headline, alternateFirstNames, identityStatus, currentCompanyName, currentCompanyUrl, ...p }) => p);
    return { people, emailFormat: format, providerPool: { pagesFetched: 1, nextPage: page + 1, exhausted: page === 10 },
      publicExpansion: { provider: 'brightdata_google', titles: ['Software Engineer'], rawCount: page * 10,
        seenProfileIds: Array.from({ length: page * 10 }, (_, i) => `person-${i}`) } };
  });
  const params: GetOrRefreshParams = { fingerprint: 'example-swe-us', company: { name: 'Example', domain: 'example.org', linkedinUrl: null },
    fingerprintInput: { companyKey: 'domain:example.org', roles: ['software engineer'], locations: ['united states'], resultLimit: 10, cacheVersion: 'v1' },
    provider: async () => { throw new Error('legacy path'); }, progressiveProvider: provider };
  return { db, cache, provider, params };
}
describe('progressive shared cache lifecycle', () => {
  it('returns the first ten before any background pages execute', async () => {
    const { cache, provider, params } = setup();
    const first = await cache.getOrRefresh(params);
    expect(first.dataset.people).toHaveLength(10); expect(provider).toHaveBeenCalledTimes(1);
    expect((await cache.getExpansionState(params.fingerprint))?.providerNextPage).toBe(2);
    await cache.fillPublicPool({ ...params, minimumPeople: 100 });
    expect(provider).toHaveBeenCalledTimes(10);
    expect((await cache.getExpansionState(params.fingerprint))?.people).toHaveLength(100);
  });
  it('serves the complete processed cache with no provider or OpenAI request', async () => {
    const { cache, provider, params } = setup(); await cache.getOrRefresh(params);
    vi.mocked(fetch).mockClear(); provider.mockClear();
    expect((await cache.getOrRefresh(params)).source).toBe('CACHE');
    expect(provider).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('Add More allocation reads stored unseen candidates before provider work', async () => {
    const { cache, provider, params } = setup(); await cache.fillPublicPool({ ...params, minimumPeople: 30 }); provider.mockClear();
    const firstIds = new Set(Array.from({ length: 10 }, (_, i) => `person-${i}`));
    const result = await cache.fillPublicPool({ ...params, minimumPeople: 10, filterReadyPeople: people => people.filter(p => !firstIds.has(p.sourceProfileId)) });
    expect(result.dataset.people.filter(p => !firstIds.has(p.sourceProfileId)).slice(0, 10).map(p => p.sourceProfileId))
      .toEqual(Array.from({ length: 10 }, (_, i) => `person-${i + 10}`));
    expect(provider).not.toHaveBeenCalled();
  });
  it('resumes a partial pool from its saved cursor', async () => {
    const { cache, provider, params } = setup(); await cache.getOrRefresh(params);
    await cache.fillPublicPool({ ...params, minimumPeople: 20 });
    expect(provider.mock.calls.map(([state]) => state?.providerNextPage ?? 1)).toEqual([1, 2]);
  });
  it('concurrent callers share one provider page', async () => {
    const { cache, provider, params } = setup();
    const [a, b] = await Promise.all([cache.getOrRefresh(params), cache.getOrRefresh(params)]);
    expect(a.dataset.people).toHaveLength(10); expect(b.dataset.people).toHaveLength(10);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('commits each batch before fetching another and keeps batches <=10', async () => {
    const { cache, provider, params, db } = setup(); const base = provider.getMockImplementation()!;
    provider.mockImplementation(async state => {
      expect(db._state.discoverCachePeople.length).toBe(((state?.providerNextPage ?? 1) - 1) * 10);
      const page = await base(state); expect(page.people.length).toBeLessThanOrEqual(10); return page;
    });
    await cache.fillPublicPool({ ...params, minimumPeople: 100 }); expect(db._state.discoverCachePeople).toHaveLength(100);
  });
  it('a failed page leaves prior batches and cursor intact for retry', async () => {
    const { cache, provider, params } = setup(); await cache.getOrRefresh(params);
    provider.mockRejectedValueOnce(new Error('safe failure'));
    await expect(cache.fillPublicPool({ ...params, minimumPeople: 20 })).rejects.toThrow('safe failure');
    expect(await cache.getExpansionState(params.fingerprint)).toMatchObject({ providerNextPage: 2, people: expect.arrayContaining([expect.objectContaining({ sourceProfileId: 'person-0' })]) });
    await cache.fillPublicPool({ ...params, minimumPeople: 20 });
    expect((await cache.getExpansionState(params.fingerprint))?.people).toHaveLength(20);
  });
  it('never executes provider work without a lock', async () => {
    const { params, provider, db } = setup();
    const cache = new DiscoverSearchCacheService({ prisma: db as unknown as PrismaClient, lock: { acquire: async () => null, release: vi.fn() }, waitTimeoutMs: 1, pollIntervalMs: 1 });
    await expect(cache.getOrRefresh(params)).rejects.toThrow('busy'); expect(provider).not.toHaveBeenCalled();
  });
});
describe('progressive public pages', () => {
  const input = { companyName: 'Example', jobTitles: ['Software Engineer'], locations: ['United States'], maxResults: 10 };
  const opts = () => ({ target: 10, validate: async (p: ReturnType<typeof person>[]) => p, denied: new PersonIdentitySet(), diagnostics: publicCounters() });
  const web = (search: any) => ({ configured: true, maxResultsPerRequest: 10, pagination: { maxPages: 10, maxResults: 100 }, peopleQueryStrategy: 'single_role_union' as const, search });
  it('pages until ten valid people, deduping locale overlap', async () => {
    const search = vi.fn(async (_q, o) => o.page === 1 ? Array.from({ length: 6 }, (_, i) => row(i)) :
      [ ...Array.from({ length: 6 }, (_, i) => ({ ...row(i), url: row(i).url.replace('www.', 'np.') })), ...Array.from({ length: 4 }, (_, i) => row(6 + i)) ]);
    const result = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles(input, opts() as never);
    expect(result.profiles).toHaveLength(10); expect(search.mock.calls.map(([, o]) => o.page)).toEqual([1, 2]);
    expect(result.providerPool).toMatchObject({ nextPage: 3, rawCount: 16, exhausted: false });
  });
  it('stops on a repeated page with no new canonical URLs', async () => {
    const search = vi.fn(async () => [row('same')]);
    const result = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles(input, opts() as never);
    expect(search).toHaveBeenCalledTimes(2); expect(result.providerPool?.exhausted).toBe(true);
  });
  it('accumulates 100 unique raw candidates and stops at ten pages', async () => {
    const search = vi.fn(async (_q, o) => Array.from({ length: 10 }, (_, i) => row(o.page * 10 + i)));
    const result = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles(input, { ...opts(), target: 100 } as never);
    expect(search).toHaveBeenCalledTimes(10); expect(result.providerPool).toMatchObject({ rawCount: 100, exhausted: true });
    expect(result.profiles).toHaveLength(100);
  });
  it('persists raw identities even for rejected candidates across continuation', async () => {
    const search = vi.fn(async () => [row('same')]);
    const o = { ...opts(), validate: vi.fn(async () => []) };
    const a = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles({ ...input, maxPages: 1 }, o as never);
    const b = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles({ ...input, startPage: 2, publicSeenProfileIds: a.providerPool!.seenProfileIds, publicRawCount: a.providerPool!.rawCount }, o as never);
    expect(b.providerPool?.exhausted).toBe(true); expect(b.profiles).toEqual([]);
  });
  it('missing evidence uses requested country only, conflicting country is rejected', async () => {
    const search = vi.fn(async () => [row('missing', ''), row('nepal', 'Kathmandu, Nepal')]);
    const o = opts(); const result = await new PublicSearchDiscoveryProvider(web(search)).searchProfiles({ ...input, maxPages: 1 }, o as never);
    expect(result.profiles).toHaveLength(1); expect(result.profiles[0]).toMatchObject({ location: 'United States', locationSource: 'requested_fallback', city: null, state: null });
    expect(o.diagnostics.publicLocationContradictionRejected).toBe(1);
  });
  it('diagnostics contain only safe counters and status, never PII', async () => {
    const o = opts(); await new PublicSearchDiscoveryProvider(web(async () => [row('private-profile')])).searchProfiles({ ...input, maxPages: 1 }, o as never);
    expect(JSON.stringify(o.diagnostics)).not.toMatch(/Jane|Doe|linkedin\.com|private-profile|Boston/);
    expect(Object.values(o.diagnostics).every(v => ['number', 'boolean', 'string'].includes(typeof v))).toBe(true);
  });
});
describe('location and role evidence', () => {
  it.each([
    ['months. Boston, Massachusetts, United States', 'Boston, Massachusetts, United States'],
    ['Example ... San Jose, California, United States', 'San Jose, California, United States'],
    ['Jane Doe. Principal Software Engineer at Example. Northeastern University. Lynn, Massachusetts, United States.Read more', 'Lynn, Massachusetts, United States']
  ])('cleans %s', (source, expected) => expect(publicLocationEvidence(source)).toBe(expected));
  it('historical job geography does not become current geography', () => {
    expect(publicLocationEvidence('Facebook 2020-2022 · Menlo Park, California, United States')).toBeNull();
  });
  it('a requested city is not evidence for fallback', () => expect(requestedCountryFallback(['Boston, Massachusetts, United States'])).toBeNull());
  it.each(['Software Engineer', 'Senior Software Engineer', 'Principal Software Engineer', 'Software Developer', 'Software Engineer II'])('accepts same-family %s', title => expect(publicPoolRoleMatches(title, ['Software Engineer'])).toBe(true));
  it.each(['VP Client Data Engineering', 'Sr Program Manager', 'DevOps Engineer', 'Data QA Engineer', 'Director of Engineering', 'Solutions Architect'])('rejects unrelated %s', title => expect(publicPoolRoleMatches(title, ['Software Engineer'])).toBe(false));
});

describe('existing AI name/location boundary', () => {
  const ai = (location: string | null = 'Boston, Massachusetts, United States') => ({ enabled: true, model: 'fixture',
    complete: vi.fn(async (request: { input: string }) => ({ items: JSON.parse(request.input).items.map((p: { id: string }) => ({
      id: p.id, displayName: 'Jane Doe', givenName: 'Jane', familyName: 'Doe', middleNames: [], generationalSuffix: null,
      removedTokens: [], confidence: 'HIGH', canGenerateEmail: true, location
    })) })) });
  it('normalizes names and locations together in <=10-person requests with stable IDs', async () => {
    const client = ai(); const people = Array.from({ length: 23 }, (_, i) => ({ ...person(i), rawLocationEvidence: 'Boston, Massachusetts, United States' }));
    const result = await normalizeDiscoverPersonNames(people, { client, publicLocations: true });
    expect(client.complete.mock.calls.map(([r]) => JSON.parse(r.input).items.length)).toEqual([10, 10, 3]);
    expect(client.complete.mock.calls.flatMap(([r]) => JSON.parse(r.input).items.map((p: { id: string }) => p.id))).toEqual(Array.from({ length: 23 }, (_, i) => String(i)));
    expect(result.every(p => p.fullName === 'Jane Doe' && p.location === 'Boston, Massachusetts, United States')).toBe(true);
    expect(client.complete.mock.calls[0][0].input).not.toMatch(/linkedin|example.org|inferredEmail/);
  });
  it('rejects invented location and does not promote a requested country to a city', async () => {
    const client = ai('Invented City, California, United States');
    const [result] = await normalizeDiscoverPersonNames([{ ...person(0), location: 'United States', city: null, state: null, country: 'United States', rawLocationEvidence: 'United States' }], { client, publicLocations: true });
    expect(result).toMatchObject({ location: 'United States', city: null, state: null });
  });
  it('retains deterministic clean names when location AI fails', async () => {
    const client = ai(); client.complete.mockRejectedValue(new Error('safe failure'));
    const [result] = await normalizeDiscoverPersonNames([{ ...person(0), rawLocationEvidence: 'United States' }], { client, publicLocations: true });
    expect(result.fullName).toBe('Jane Doe');
  });
  it('rejects duplicate or mismatched IDs rather than assigning output to another person', async () => {
    const client = ai(); const impl = client.complete.getMockImplementation()!;
    client.complete.mockImplementation(async request => {
      const r = await impl(request); r.items.forEach((item: { id: string }) => { item.id = 'wrong'; }); return r;
    });
    const [result] = await normalizeDiscoverPersonNames([{ ...person(0), rawLocationEvidence: 'United States', location: 'United States' }], { client, publicLocations: true });
    expect(result.location).toBe('United States');
  });
});

describe('conservative metadata and durable continuation', () => {
  it('duplicate upserts preserve verified email and corrected profile metadata', async () => {
    const { cache, params, provider, db } = setup(); await cache.getOrRefresh(params);
    Object.assign(db._state.discoverCachePeople[0], { fullName: 'Corrected Name', firstName: 'Corrected', lastName: 'Name',
      location: 'Lynn, Massachusetts, United States', locationSource: 'manual', inferredEmail: 'verified@example.org', emailStatus: 'VERIFIED' });
    const page = await provider(null); page.people[0].location = 'United States';
    await cache.appendProviderPeople({ ...params, people: page.people, emailFormat: format, nextPage: 2, pagesFetched: 0, exhausted: false });
    expect(db._state.discoverCachePeople[0]).toMatchObject({ fullName: 'Corrected Name', location: 'Lynn, Massachusetts, United States', inferredEmail: 'verified@example.org', emailStatus: 'VERIFIED' });
    expect(db._state.discoverCachePeople).toHaveLength(10);
  });
  it('refreshes an expired cursor only after replacement work succeeds', async () => {
    const { cache, params, provider, db } = setup(); await cache.getOrRefresh(params);
    db._state.discoverCache[0].expiresAt = new Date(0);
    await cache.getOrRefresh(params);
    expect(provider.mock.calls.map(([s]) => s?.providerNextPage ?? 1)).toEqual([1, 1]);
    expect((await cache.getExpansionState(params.fingerprint))?.people).toHaveLength(10);
  });
  it('later former-employment evidence suppresses a previously cached identity', async () => {
    const input = { companyName: 'Example', jobTitles: ['Software Engineer'], locations: ['United States'], maxResults: 10, startPage: 2,
      publicSeenProfileIds: ['person-0'], publicRawCount: 10 };
    const web = { configured: true, pagination: { maxPages: 10, maxResults: 100 }, maxResultsPerRequest: 10,
      peopleQueryStrategy: 'single_role_union' as const, search: async () => [{
        ...row(0, 'Formerly at Example'), title: 'Jane Doe - Software Engineer | LinkedIn'
      }] };
    const result = await new PublicSearchDiscoveryProvider(web).searchProfiles(input, { target: 10, validate: async p => p,
      denied: new PersonIdentitySet(), diagnostics: publicCounters() });
    expect(result.providerPool?.deniedProfileIds).toEqual(['person-0']); expect(result.profiles).toEqual([]);
  });
});
