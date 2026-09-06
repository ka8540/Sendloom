import { describe, it, expect, vi } from 'vitest';
import { buildPublicPeopleSearchQuery } from './public-people-query-builder';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { validateCurrentEmployment } from './current-employment-evidence';
import { PublicSearchDiscoveryProvider, publicCounters, PUBLIC_SEARCH_LIMITS } from './public-profile-search';
import { discoverProfiles, publicProfileValidator } from './prospect-discovery-provider';
import { PersonIdentitySet } from './discover-person-identity';
import { dedupeProfiles, type ApifyProfileSearchResult } from './apify-profile-search';
import type { WebSearchResult } from './web-search-provider';
import { reuseExistingPeople } from './discover-existing-person';
import type { ProspectPerson } from '@prisma/client';
import type { ResolvedCachePerson } from './discover-cache-service';
import { normalizeDiscoverPersonNames } from './discover-person-name-normalization';
import { DiscoverRoleIntelligenceService } from './discover-role-intelligence-service';
import { RoleClassificationService } from './role-classification-service';

const companyName = 'Abacus Insights';
const input = { companyName, jobTitles: ['Software Engineer'], locations: ['United States'], maxResults: 25 };
const result = (id = 'jane-doe', position = 'Software Engineer at Abacus Insights', snippet?: string): WebSearchResult => ({
  title: `Jane Doe - ${position} | LinkedIn`, url: `https://www.linkedin.com/in/${id}`,
  snippet: snippet ?? `${position} · Boston, Massachusetts, United States`
});
const profile = (id: string) => parseLinkedInSearchResult(result(id))!;
const accept = async (p: ReturnType<typeof profile>[]) => p;
const searchOptions = () => ({ target: 10, validate: accept, denied: new PersonIdentitySet(), diagnostics: publicCounters() });
const apifyResult = (ids: string[]): ApifyProfileSearchResult => ({ profiles: ids.map(profile), runId: 'run', datasetId: 'data', totalFound: ids.length,
  diagnostics: { itemsReturned: ids.length, parsedCandidates: ids.length, rejectedBySchema: 0, duplicateItems: 0, companyMatched: ids.length, rejectedByCompany: 0 } });

describe('public query and strict URL identity', () => {
  it('builds the exact company, role and location query', () => {
    expect(buildPublicPeopleSearchQuery({ companyName, jobTitle: 'Software Engineer', location: 'United States' }))
      .toBe('site:linkedin.com/in "Abacus Insights" "Software Engineer" "United States"');
  });
  it('omits absent location', () => expect(buildPublicPeopleSearchQuery({ companyName: 'Mastercard', jobTitle: 'Software Engineer' }))
    .toBe('site:linkedin.com/in "Mastercard" "Software Engineer"'));
  it('contains quoted input and collapses controls, quotes and whitespace', () => {
    expect(buildPublicPeopleSearchQuery({ companyName: '  A " B\\ C\n', jobTitle: ' Software   Engineer ' }))
      .toBe('site:linkedin.com/in "A B C" "Software Engineer"');
  });
  it.each(['https://linkedin.com/in/jane-doe/', 'https://www.linkedin.com/in/jane-doe?trk=abc',
    'http://www.linkedin.com/in/JANE-DOE/#about', 'https://uk.linkedin.com/in/jane-doe'])('canonicalizes %s', url => {
    expect(canonicalizeLinkedInProfileUrl(url)).toEqual({ linkedinUrl: 'https://linkedin.com/in/jane-doe', sourceProfileId: 'jane-doe' });
  });
  it.each(['company/acme', 'jobs/123', 'posts/123', 'feed/123', 'school/acme', 'in/jane/posts', 'in/a%2Fb', 'in/'])('rejects non-person path %s', path => {
    expect(canonicalizeLinkedInProfileUrl(`https://linkedin.com/${path}`)).toBeNull();
  });
  it.each(['https://evil.com/in/jane', 'https://linkedin.com.evil.com/in/jane', 'https://user@linkedin.com/in/jane', 'ftp://linkedin.com/in/jane'])('rejects unsafe URL %s', url => {
    expect(canonicalizeLinkedInProfileUrl(url)).toBeNull();
  });
});
describe('evidence, never query keywords', () => {
  it.each(['Jane Doe - Software Engineer at Abacus Insights | LinkedIn', 'Jane Doe | Software Engineer at Abacus Insights | LinkedIn',
    'Jane Doe - Software Engineer - Abacus Insights | LinkedIn', 'Jane Doe - Software Engineer · Abacus Insights | LinkedIn'])('parses %s', title => {
    const row = { ...result(), title };
    const p = parseLinkedInSearchResult(row)!;
    expect(p).toMatchObject({ sourceName: 'Jane Doe', currentTitle: 'Software Engineer', currentCompanyName: companyName,
      location: 'Boston, Massachusetts, United States', sourceProfileId: 'jane-doe' });
    expect(validateCurrentEmployment(row, p, companyName).decision).toBe('CURRENT');
  });
  it.each(['Former Software Engineer at Abacus Insights', 'Previously at Abacus Insights', 'Ex-Abacus Insights',
    'Worked at Abacus Insights', 'Past: Abacus Insights', 'Formerly with Abacus Insights',
    'Software Engineer at NewCo · Previously at Abacus Insights', 'Abacus Insights 2021-2024', 'Abacus Insights 2021 – 2024', 'Software Engineer at Abacus Insights (2021–2024)',
    'Software Engineer at Abacus Insights until 2024', 'Left Abacus Insights', 'No longer at Abacus Insights', 'Abacus Insights alumni'])('rejects historical evidence: %s', snippet => {
    const row = result('jane', 'Software Engineer at Abacus Insights', snippet);
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, companyName).decision).toBe('FORMER');
  });
  it('fails closed on vague company mentions', () => {
    const row = result('jane', 'Software Engineer', 'Interested in Abacus Insights');
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, companyName).decision).toBe('AMBIGUOUS');
  });
  it('compares company aliases', () => {
    const row = result('jane', 'Software Engineer at JPMorgan');
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, 'JPMorgan Chase & Co.').decision).toBe('CURRENT');
  });
  it('preserves credential source text for the shared normalizer', async () => {
    const p = parseLinkedInSearchResult({ ...result(), title: 'Rae Gruppman SHRM-CP - Software Engineer at Abacus Insights | LinkedIn' })!;
    expect(p.sourceName).toBe('Rae Gruppman SHRM-CP');
    expect(p.lastName).not.toBe('SHRM-CP');
    const [safe] = await normalizeDiscoverPersonNames([p], { client: { enabled: false } as never });
    expect(safe.lastName).not.toBe('SHRM-CP');
    expect(safe.identityStatus).toBe('INCOMPLETE');
  });
});
describe('bounded search, dedupe and Add More', () => {
  it('dedupes across queries, pages and tracking, keeps different same-name profiles', async () => {
    const search = vi.fn(async (_q, o) => o.page === 1 ? [result('jane'), { ...result('jane'), url: 'https://linkedin.com/in/jane/?trk=x' }]
      : o.page === 2 ? [result('jane'), result('jane-two')] : []);
    const p = new PublicSearchDiscoveryProvider({ configured: true, search });
    const response = await p.searchProfiles({ ...input, jobTitles: ['Software Engineer', 'Backend Engineer'] }, searchOptions());
    expect(response.profiles.map(p => p.sourceProfileId)).toEqual(['jane', 'jane-two']);
  });
  it('excludes already allocated people and continues to new valid later results', async () => {
    const search = vi.fn(async (_q, o) => o.page === 1 ? [result('old')] : [result('former', 'Former Software Engineer at Abacus Insights'), result('new')]);
    const o = { ...searchOptions(), target: 1, excluded: new PersonIdentitySet([profile('old')]) };
    const response = await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles(input, o);
    expect(response.profiles.map(p => p.sourceProfileId)).toEqual(['new']);
    expect(o.diagnostics.formerEmployeeRejected).toBe(1);
    expect(search).toHaveBeenCalledTimes(2);
  });
  it('caps queries/pages regardless of input maxResults and role list size', async () => {
    const search = vi.fn(async () => [result('former', 'Former Software Engineer at Abacus Insights')]);
    await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles({ ...input, maxResults: 99999,
      jobTitles: Array.from({ length: 100 }, (_, i) => `Role ${i}`) }, searchOptions());
    expect(search).toHaveBeenCalledTimes(PUBLIC_SEARCH_LIMITS.queries * PUBLIC_SEARCH_LIMITS.pages);
  });
  it('counts downstream validity before stopping', async () => {
    const search = vi.fn(async (_q, o) => [result(o.page === 1 ? 'bad-role' : 'good')]);
    const o = { ...searchOptions(), target: 1, validate: async (p: ReturnType<typeof profile>[]) => p.filter(p => p.sourceProfileId === 'good') };
    const r = await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles(input, o);
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['good']);
    expect(o.diagnostics.roleOrLocationRejected).toBe(1);
  });
  it('removes previously accepted identities when later evidence says former', async () => {
    const search = vi.fn(async (_q, o) => [result('jane', o.page === 1 ? 'Software Engineer at Abacus Insights' : 'Former Software Engineer at Abacus Insights')]);
    const r = await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles(input, searchOptions());
    expect(r.profiles).toEqual([]);
  });
  it('normalizes cross-provider URL identity before ingestion dedupe', () => {
    expect(dedupeProfiles([profile('jane'), { ...profile('jane'), sourceProfileId: 'actor-123', linkedinUrl: 'https://www.linkedin.com/in/jane/?trk=x' }])).toHaveLength(1);
    expect(dedupeProfiles([profile('jane'), profile('jane-two')])).toHaveLength(2);
  });
});
describe('large provider windows (You.com count 25)', () => {
  const youLike = (search: ReturnType<typeof vi.fn>) =>
    new PublicSearchDiscoveryProvider({ configured: true, maxResultsPerRequest: 100, search });
  it('requests one 25-result LinkedIn-filtered window and stops when it fills the target', async () => {
    const search = vi.fn(async () => Array.from({ length: 25 }, (_, i) => result(`p${i}`)));
    const o = searchOptions();
    const response = await youLike(search).searchProfiles(input, o);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('site:linkedin.com/in "Abacus Insights" "Software Engineer" "United States"',
      expect.objectContaining({ page: 1, count: 25, includeDomains: ['linkedin.com'] }));
    expect(response.profiles.length).toBeGreaterThanOrEqual(10);
    expect(o.diagnostics).toMatchObject({ publicSearchQueries: 1, publicSearchPages: 1, rawSearchResults: 25 });
  });
  it('requests the next offset only when the first window is insufficient, deduping across offsets', async () => {
    const search = vi.fn(async (_q: string, o: { page?: number }) =>
      o.page === 1 ? [result('jane')] : [result('jane'), result('john')]);
    const o = { ...searchOptions(), target: 2 };
    const response = await youLike(search).searchProfiles(input, o);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(call => (call[1] as { page: number }).page)).toEqual([1, 2]);
    expect(response.profiles.map(p => p.sourceProfileId)).toEqual(['jane', 'john']);
    expect(o.diagnostics.duplicateRejected).toBe(1);
  });
  it('requests the next role query only when earlier queries are insufficient', async () => {
    const queries: string[] = [];
    const search = vi.fn(async (query: string) => { queries.push(query); return Array.from({ length: 10 }, (_, i) => result(`p${i}`)); });
    const response = await youLike(search).searchProfiles({ ...input, jobTitles: ['Software Engineer', 'Backend Engineer'] }, searchOptions());
    expect(response.profiles.length).toBeGreaterThanOrEqual(10);
    expect(queries).toEqual(['site:linkedin.com/in "Abacus Insights" "Software Engineer" "United States"']);
  });
  it('dedupes the same person across role queries and keeps distinct same-name people', async () => {
    const search = vi.fn(async (query: string) => query.includes('Software Engineer')
      ? [result('jane'), { ...result('jane'), url: 'https://www.linkedin.com/in/jane/?trk=search' }]
      : [result('jane'), result('jane-two')]);
    const response = await youLike(search).searchProfiles({ ...input, jobTitles: ['Software Engineer', 'Backend Engineer'] }, { ...searchOptions(), target: 2 });
    expect(response.profiles.map(p => p.sourceProfileId)).toEqual(['jane', 'jane-two']);
  });
});
describe('hybrid fallback', () => {
  it('fills an eight-person deficit, merging the cross-provider duplicate', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: vi.fn(async () => Array.from({ length: 8 }, (_, i) => result(`p${i}`))) });
    const apify = { searchProfiles: vi.fn(async () => apifyResult(['p0', 'p8', 'p9'])) };
    const r = await discoverProfiles(input, { mode: 'hybrid', apify, validate: accept, target: 10, publicProvider: web });
    expect(r.profiles).toHaveLength(10); expect(apify.searchProfiles).toHaveBeenCalledTimes(1);
  });
  it('never calls Apify when public produces ten', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: vi.fn(async () => Array.from({ length: 10 }, (_, i) => result(`p${i}`))) });
    const apify = { searchProfiles: vi.fn() };
    const r = await discoverProfiles(input, { mode: 'hybrid', apify, validate: accept, target: 10, publicProvider: web });
    expect(r.profiles).toHaveLength(10); expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
  it.each([false, true])('falls back when public unavailable/fails (%s)', async configured => {
    const web = new PublicSearchDiscoveryProvider({ configured, search: vi.fn(async () => { throw new Error('secret payload'); }) });
    const apify = { searchProfiles: vi.fn(async () => apifyResult(['fallback'])) };
    const r = await discoverProfiles(input, { mode: 'hybrid', apify, validate: accept, target: 1, publicProvider: web });
    expect(r.profiles[0].sourceProfileId).toBe('fallback');
  });
  it('returns empty safely in public-only mode', async () => {
    const r = await discoverProfiles(input, { mode: 'public_search', apify: { searchProfiles: vi.fn() }, validate: accept, target: 10,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => [] }) });
    expect(r.profiles).toEqual([]);
  });
  it('never surfaces provider payload errors', async () => {
    await expect(discoverProfiles(input, { mode: 'public_search', apify: { searchProfiles: vi.fn() }, validate: accept, target: 10,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => { throw Error('PII secret'); } }) }))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: 'Public people search is temporarily unavailable.' });
  });
});
describe('existing metadata protection', () => {
  it.each(['VERIFIED', 'INVALID', 'UNSUBSCRIBED', 'BOUNCED'])('reuses URL identity and preserves %s', emailStatus => {
    const stored = { ...profile('jane'), id: 'db', userId: 'user', companyId: 'company', sourceProfileId: 'actor-id',
      firstName: 'Janet', fullName: 'Janet Doe', inferredEmail: 'protected@example.test', emailStatus, emailSource: 'MANUAL' } as unknown as ProspectPerson;
    const [reused] = reuseExistingPeople([profile('jane') as unknown as ResolvedCachePerson], [stored], 'company');
    expect(reused).toMatchObject({ sourceProfileId: 'actor-id', firstName: 'Janet', fullName: 'Janet Doe', inferredEmail: 'protected@example.test', emailStatus });
  });
});

describe('existing role/location/name pipeline', () => {
  it('uses real deterministic role intelligence even with vector mode disabled', async () => {
    const { createFakePrisma } = await import('./__test-utils__/fake-prisma');
    const { createAiBudget } = await import('./prospect-ai');
    const classifier = new RoleClassificationService(createFakePrisma() as never, { enabled: false } as never);
    const roles = new DiscoverRoleIntelligenceService(classifier, {} as never, {} as never, {
      enabled: false, embeddingModel: 'text-embedding-3-small', embeddingDimensions: 1536,
      semanticVersion: 'test-v1', maxApifyTitlesPerRole: 5, maxApifyTitlesTotal: 8
    });
    const validate = publicProfileValidator({ roleClassifier: classifier, roleIntelligence: roles,
      requestedTitles: ['Software Engineer'], locations: ['United States'], companyName, options: { budget: createAiBudget() } });
    const p = (title: string, location = 'Boston, Massachusetts, United States') => parseLinkedInSearchResult(
      result(title.replace(/ /g, '-'), `${title} at Abacus Insights`, `${title} at Abacus Insights · ${location}`))!;
    const valid = await validate([p('Software Engineer'), p('Backend Engineer'), p('Recruiter'), p('Product Manager'),
      p('Data Analyst'), p('Sales Manager'), p('Software Developer', 'Toronto, Ontario, Canada')]);
    expect(valid.map(p => p.currentTitle)).toEqual(['Software Engineer', 'Backend Engineer']);
    expect(valid[0]).toMatchObject({ firstName: 'Jane', lastName: 'Doe', sourceName: 'Jane Doe', identityStatus: 'COMPLETE' });
    expect(valid[0].nameNormalization).toContain('DETERMINISTIC');
  });
});


describe('privacy-safe diagnostics', () => {
  it('logs counters only, including on a failing provider', async () => {
    const previous = process.env.NODE_ENV;
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'development');
    try {
      await discoverProfiles(input, { mode: 'hybrid', apify: { searchProfiles: async () => apifyResult(['jane']) },
        validate: accept, target: 1, publicProvider: new PublicSearchDiscoveryProvider({ configured: true,
          search: async () => { throw new Error('Jane Doe https://linkedin.com/in/jane secret@example.test'); } }) });
      const entry = log.mock.calls.find(call => call[0] === '[discover-public-search]')!;
      const counters = JSON.parse(entry[1]);
      expect(Object.values(counters).every(value => typeof value === 'number' || typeof value === 'boolean')).toBe(true);
      expect(counters).toMatchObject({ apifyFallbackCalled: true, providerFailed: true });
      expect(JSON.stringify(entry)).not.toMatch(/Jane Doe|https:|secret@example/);
    } finally { vi.stubEnv('NODE_ENV', previous); log.mockRestore(); }
  });
});


describe('deadline and contradictory evidence safeguards', () => {
  it('does not launch Apify after the overall Discover deadline', async () => {
    const controller = new AbortController();
    const apify = { searchProfiles: vi.fn() };
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: async () => {
      controller.abort(); throw new Error('timeout');
    } });
    await expect(discoverProfiles(input, { mode: 'hybrid', apify, publicProvider: web, validate: accept, target: 10,
      signal: controller.signal })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
  it('explicit different current snippet employer overrides a positive headline', () => {
    const row = result('jane', 'Software Engineer at Abacus Insights', 'Software Engineer at NewCo');
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, companyName).decision).toBe('AMBIGUOUS');
  });
  it('does not resurrect a former employee in fallback or expose a raw replay dataset', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: async () => [result('former', 'Former Software Engineer at Abacus Insights')] });
    const r = await discoverProfiles(input, { mode: 'hybrid', publicProvider: web, validate: accept, target: 1,
      apify: { searchProfiles: async () => apifyResult(['former', 'current']) } });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['current']);
    expect(r.datasetId).toBeNull();
  });
});
