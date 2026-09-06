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
const optiverInput = { companyName: 'Optiver', jobTitles: ['Software Engineer'], locations: ['United States'], maxResults: 25 };
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
  it('fails closed on vague company mentions as insufficient evidence', () => {
    const row = result('jane', 'Software Engineer', 'Interested in Abacus Insights');
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, companyName)).toMatchObject(
      { decision: 'INSUFFICIENT', reason: 'INSUFFICIENT_EVIDENCE' });
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
describe('Optiver You.com result structures', () => {
  const optiverResult = (id: string, title: string, snippet: string): WebSearchResult =>
    ({ title, url: `https://www.linkedin.com/in/${id}`, snippet });
  const optResult = (id: string, position = 'Software Engineer at Optiver', snippet?: string): WebSearchResult => ({
    title: `Jane Doe - ${position} | LinkedIn`, url: `https://www.linkedin.com/in/${id}`,
    snippet: snippet ?? `${position} · Boston, Massachusetts, United States`
  });
  const decided = (row: WebSearchResult) => {
    const p = parseLinkedInSearchResult(row);
    return { profile: p, evidence: p ? validateCurrentEmployment(row, p, 'Optiver') : null };
  };
  it('accepts headline evidence in every common layout', () => {
    expect(decided(optiverResult('alice', 'Alice Example - Software Engineer at Optiver | LinkedIn',
      'Software Engineer at Optiver · Chicago, Illinois, United States')).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('bob', 'Bob Example - Software Engineer at Optiver | LinkedIn',
      'Chicago, Illinois, United States · Software Engineer at Optiver · 500+ connections')).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('charlie', 'Charlie Example - Software Engineer - Optiver | LinkedIn',
      'Software Engineer · Optiver · Chicago, Illinois, United States')).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('dana', 'Dana Example - Software Engineer at Optiver | LinkedIn',
      "View Dana Example's profile on LinkedIn, the world's largest professional community. Dana has 4 jobs listed on their profile.")).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('erin', 'Erin Example | Software Engineer at Optiver | LinkedIn',
      'Software Engineer at Optiver · Chicago, Illinois, United States')).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('frank', 'Frank Example - Optiver | LinkedIn',
      'Software Engineer at Optiver · Chicago, Illinois, United States')).evidence?.decision).toBe('CURRENT');
    expect(decided(optiverResult('grace', 'Grace Example - Optiver | LinkedIn',
      'Chicago, Illinois, United States · Software Engineer · Optiver')).evidence?.decision).toBe('CURRENT');
  });
  it('keeps location-first snippets readable and never manufactures location into a title or company', () => {
    const bob = decided(optiverResult('bob', 'Bob Example - Software Engineer at Optiver | LinkedIn',
      'Chicago, Illinois, United States · Software Engineer at Optiver · 500+ connections')).profile;
    expect(bob).toMatchObject({ currentTitle: 'Software Engineer', currentCompanyName: 'Optiver', location: 'Chicago, Illinois, United States' });
    for (const [id, snippet] of [
      ['hist', 'Experience: Optiver · Education: Delft University of Technology'],
      ['pair', 'Optiver · Chicago, Illinois, United States'],
      ['jobs', 'Optiver · Full-time · Software Engineer'],
      ['country', 'United States · Optiver']] as const) {
      const d = decided(optiverResult(id, `${id} Example - Optiver | LinkedIn`, snippet));
      expect(d.profile?.currentCompanyName ?? null).not.toBe('Chicago, Illinois, United States');
      expect(d.profile?.currentCompanyName ?? null).not.toBe('Full-time');
      expect(d.profile?.currentCompanyName ?? null).not.toBe('Education: Delft University of Technology');
      expect(d.evidence?.reason ?? null).not.toBe('COMPANY_MISMATCH');
    }
  });
  it('rejects explicit former employees and different current employers, failing closed without mislabeling', () => {
    const former = decided(optiverResult('erin', 'Erin Example - Former Software Engineer at Optiver | LinkedIn',
      'Former Software Engineer at Optiver · Chicago, Illinois, United States'));
    expect(former.evidence).toMatchObject({ decision: 'FORMER' });
    const elsewhere = decided(optiverResult('irene', 'Irene Example - Software Engineer at IMC Trading | LinkedIn',
      'Software Engineer at IMC Trading · Chicago, Illinois, United States'));
    expect(elsewhere.evidence).toMatchObject({ decision: 'CONTRADICTORY', reason: 'COMPANY_MISMATCH' });
    expect(elsewhere.profile?.currentCompanyName).toBe('IMC Trading');
  });
  it('classifies company-only You.com snippets as INSUFFICIENT, never contradiction', () => {
    for (const snippet of [
      'Experience: Optiver · Education: Delft University of Technology',
      'Optiver · Chicago, Illinois, United States',
      'Optiver · Full-time · Software Engineer',
      'United States · Optiver']) {
      const d = decided(optiverResult('hist', 'Hist Example - Optiver | LinkedIn', snippet));
      expect(d.evidence).toMatchObject({ decision: 'INSUFFICIENT', reason: 'INSUFFICIENT_EVIDENCE' });
    }
  });
  it('missing location metadata is counted and accepted, while an explicit wrong location rejects', async () => {
    const search = vi.fn(async (_q: string, o: { page?: number }) => (o.page === 1
      ? [optResult('alice'), { ...optResult('bob'), snippet: '' }, { ...optResult('charlie'), snippet: 'Software Engineer at Optiver · London, United Kingdom' }]
      : []));
    const o = { ...searchOptions(), target: 3 };
    const r = await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles(optiverInput, o);
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['alice', 'bob']);
    expect(o.diagnostics).toMatchObject({
      publicLocationMissing: 1, publicLocationContradictionRejected: 1, publicAcceptedUnique: 2, acceptedUnique: 2
    });
  });
  it('reports the granular public funnel counters without names or URLs', async () => {
    const search = vi.fn(async (_q: string, o: { page?: number }) => (o.page === 1
      ? [
          optResult('alice'), { ...optResult('alice'), url: 'https://www.linkedin.com/in/alice/?trk=dup' },
          optResult('former', 'Former Software Engineer at Optiver'),
          { ...optResult('elsewhere'), snippet: 'Software Engineer at IMC Trading' },
          optResult('vague', 'Optiver', 'Experience: Optiver')]
      : []));
    const o = searchOptions();
    await new PublicSearchDiscoveryProvider({ configured: true, search }).searchProfiles(optiverInput, o);
    expect(o.diagnostics).toMatchObject({
      publicCurrentAccepted: 2, publicFormerRejected: 1, publicCompanyContradictionRejected: 1,
      publicCompanyInsufficient: 1, publicDuplicateRejected: 1, publicAcceptedUnique: 1, acceptedUnique: 1
    });
  });
  it('a contradictory or insufficient public identity is not a strong negative, so trusted Apify fallback can accept it', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: vi.fn(async () => [
      { title: 'Alice Example - Software Engineer at Optiver | LinkedIn', url: 'https://linkedin.com/in/alice-example',
        snippet: 'Software Engineer at IMC Trading · Experience: IMC Trading · Optiver' }]) });
    const apify = { searchProfiles: vi.fn(async () => apifyResult(['alice-example'])) };
    const r = await discoverProfiles(optiverInput, { mode: 'hybrid', apify, validate: accept, target: 1, publicProvider: web });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['alice-example']);
    expect(apify.searchProfiles).toHaveBeenCalledTimes(1);
    expect(r.diagnostics).toMatchObject({ apifyCalls: 1, apifySuppressedByPublicStrongNegative: 0, apifyAcceptedIntoHybrid: 1 });
  });
  it('explicit former evidence about the target company still suppresses the same fallback identity', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: async () => [result('former', 'Former Software Engineer at Abacus Insights')] });
    const r = await discoverProfiles(input, { mode: 'hybrid', publicProvider: web, validate: accept, target: 1,
      apify: { searchProfiles: async () => apifyResult(['former', 'current']) } });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['current']);
    expect(r.diagnostics).toMatchObject({ apifySuppressedByPublicStrongNegative: 1, apifyAcceptedIntoHybrid: 1, apifyCalls: 1 });
  });
});

describe('provider modes never cross boundaries', () => {
  const apifyStub = () => ({ searchProfiles: vi.fn(async () => apifyResult(['apify-person'])) });
  it('public_search success never invokes Apify', async () => {
    const apify = apifyStub();
    const r = await discoverProfiles(input, { mode: 'public_search', apify, validate: accept, target: 1,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => [result('jane')] }) });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['jane']);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
    expect(r.diagnostics.finalAcceptedUnique).toBe(1);
  });
  it('public_search with zero provider results never invokes Apify', async () => {
    const apify = apifyStub();
    const r = await discoverProfiles(input, { mode: 'public_search', apify, validate: accept, target: 10,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => [] }) });
    expect(r.profiles).toEqual([]);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
    expect(r.diagnostics.finalAcceptedUnique).toBe(0);
  });
  it('public_search with zero accepted never invokes Apify', async () => {
    const apify = apifyStub();
    const r = await discoverProfiles(input, { mode: 'public_search', apify, validate: accept, target: 10,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => [result('former', 'Former Software Engineer at Abacus Insights')] }) });
    expect(r.profiles).toEqual([]);
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
  it('public_search provider failure never invokes Apify', async () => {
    const apify = apifyStub();
    await expect(discoverProfiles(input, { mode: 'public_search', apify, validate: accept, target: 10,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: async () => { throw new Error('provider down'); } }) }))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
  it('public_search deadline timeout never invokes Apify', async () => {
    const apify = apifyStub();
    const controller = new AbortController();
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: async () => {
      controller.abort(); throw new Error('timeout');
    } });
    await expect(discoverProfiles(input, { mode: 'public_search', apify, publicProvider: web, validate: accept, target: 10,
      signal: controller.signal })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(apify.searchProfiles).not.toHaveBeenCalled();
  });
  it('apify mode never invokes the public provider', async () => {
    const publicSearch = vi.fn();
    const apify = apifyStub();
    const r = await discoverProfiles(input, { mode: 'apify', apify, validate: accept, target: 1,
      publicProvider: new PublicSearchDiscoveryProvider({ configured: true, search: publicSearch }) });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['apify-person']);
    expect(publicSearch).not.toHaveBeenCalled();
  });
});

describe('hybrid fallback diagnostics', () => {
  it('counts Apify fallback stages without names or payloads', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: vi.fn(async () => []) });
    let calls = 0;
    const apify = { searchProfiles: vi.fn(async () => (calls++ === 0 ? apifyResult(['p0', 'p8', 'p9']) : { ...apifyResult([]), totalFound: 0 })) };
    const r = await discoverProfiles(input, { mode: 'hybrid', apify, validate: accept, target: 10, publicProvider: web });
    expect(r.profiles).toHaveLength(3);
    expect(r.diagnostics).toMatchObject({
      apifyFallbackCalled: true, apifyCalls: 2, apifyRawReturned: 3, apifyParsed: 3, apifyCompanyMatched: 3,
      apifyRejectedCompany: 0, apifySuppressedByPublicStrongNegative: 0, apifyDeduplicated: 0, apifyAcceptedIntoHybrid: 3
    });
  });
  it('counts cross-provider duplicates dropped in the merge', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: vi.fn(async () => [result('p0')]) });
    let calls = 0;
    const apify = { searchProfiles: vi.fn(async () => (calls++ === 0 ? apifyResult(['p0', 'p8']) : { ...apifyResult([]), totalFound: 0 })) };
    const r = await discoverProfiles(input, { mode: 'hybrid', apify, validate: accept, target: 10, publicProvider: web });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['p0', 'p8']);
    expect(r.diagnostics).toMatchObject({ apifyAcceptedIntoHybrid: 2, apifyDeduplicated: 1 });
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
    expect(validateCurrentEmployment(row, parseLinkedInSearchResult(row)!, companyName)).toMatchObject(
      { decision: 'CONTRADICTORY', reason: 'COMPANY_MISMATCH' });
  });
  it('does not resurrect a former employee in fallback or expose a raw replay dataset', async () => {
    const web = new PublicSearchDiscoveryProvider({ configured: true, search: async () => [result('former', 'Former Software Engineer at Abacus Insights')] });
    const r = await discoverProfiles(input, { mode: 'hybrid', publicProvider: web, validate: accept, target: 1,
      apify: { searchProfiles: async () => apifyResult(['former', 'current']) } });
    expect(r.profiles.map(p => p.sourceProfileId)).toEqual(['current']);
    expect(r.datasetId).toBeNull();
  });
});
