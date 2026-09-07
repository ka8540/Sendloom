import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright-core';
import { PlaywrightGoogleSearchProvider, type GoogleCrawlLimits } from './playwright-google-search-provider';
import type { PublicCrawlDiagnostics } from './web-search-provider';
import { parseLinkedInSearchResult } from './linkedin-search-result-parser';
import { discoverProfiles } from './prospect-discovery-provider';
import { getEnv } from '@/lib/env';

const query = 'site:linkedin.com/in "Abacus Insights" ("Software Engineer" OR "Software Developer")';
const url = (start: number, q = query) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&start=${start}`;
const row = (id: string) => ({ title: 'Jane Doe - Software Engineer at Abacus Insights | LinkedIn', url: `https://uk.linkedin.com/in/${id}/?trk=test`, snippet: 'Boston, Massachusetts' });
type Fixture = { ids: string[]; next?: string; body?: string; ok?: boolean; error?: boolean };
function fixture(pages: Fixture[], limits: Partial<GoogleCrawlLimits> = {}) {
  let currentUrl = ''; let current = -1;
  const page = {
    mainFrame: () => ({}), url: () => currentUrl,
    goto: vi.fn(async (u: string) => { current++; currentUrl = u; if (pages[current].error) throw Error('private payload'); return { ok: () => pages[current].ok !== false }; }),
    evaluate: vi.fn(async () => pages[current].ids.map(row)),
    locator: vi.fn(() => ({ innerText: async () => pages[current].body ?? 'Search results', count: async () => 0,
      evaluateAll: async () => pages[current].next ? [pages[current].next] : [], first: () => ({ waitFor: async () => undefined }) }))
  };
  const context = { newPage: async () => page, route: vi.fn() };
  const browser = { newContext: async () => context, close: vi.fn(async () => undefined) };
  const launch = vi.fn(async () => browser as unknown as Browser);
  const provider = new PlaywrightGoogleSearchProvider(launch, { maxPages: 10, maxCandidates: 250, timeoutMs: 60000, navigationTimeoutMs: 10000, ...limits });
  let stats: PublicCrawlDiagnostics | undefined;
  const run = () => provider.search(query, { count: 10, onCrawlDiagnostics: d => { stats = d; } });
  return { page, browser, launch, provider, run, stats: () => stats };
}

describe('bounded Google crawl', () => {
  it('retains more than ten candidates across Next links for one query and closes once', async () => {
    const f = fixture([{ ids: Array.from({ length: 12 }, (_, i) => `a-${i}`), next: url(10) }, { ids: Array.from({ length: 12 }, (_, i) => `b-${i}`) }]);
    expect(await f.run()).toHaveLength(24);
    expect(f.page.goto).toHaveBeenCalledTimes(2); expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.page.goto.mock.calls.every(([u]) => new URL(u).searchParams.get('q') === query)).toBe(true);
    expect(f.stats()).toMatchObject({ playwrightPagesVisited: 2, stopReason: 'no_next', profilesWithLocation: 24 });
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    { pages: [{ ids: ['a'], next: url(10) }, { ids: ['a'], next: url(20) }], limits: {}, visits: 2, reason: 'no_new_profiles' },
    { pages: [{ ids: ['a'], next: url(10) }], limits: { maxPages: 1 }, visits: 1, reason: 'max_pages' },
    { pages: [{ ids: ['a', 'b', 'c'], next: url(10) }], limits: { maxCandidates: 2 }, visits: 1, reason: 'max_candidates' },
    { pages: [{ ids: [], next: url(10) }], limits: {}, visits: 1, reason: 'no_new_profiles' },
    { pages: [{ ids: ['a'], next: url(10, 'unrelated') }], limits: {}, visits: 1, reason: 'no_next' },
    { pages: [{ ids: ['a'], next: 'https://linkedin.com/in/a' }], limits: {}, visits: 1, reason: 'no_next' },
    { pages: [{ ids: [], body: 'Your search did not match any documents.' }], limits: {}, visits: 1, reason: 'no_results' }
  ])('stops at $reason', async ({ pages, limits, visits, reason }) => {
    const f = fixture(pages, limits); const results = await f.run();
    expect(f.page.goto).toHaveBeenCalledTimes(visits); expect(f.stats()?.stopReason).toBe(reason);
    if (limits.maxCandidates) expect(results).toHaveLength(limits.maxCandidates);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it.each(['CAPTCHA', 'reCAPTCHA', 'Our systems have detected unusual traffic', 'Access denied', 'Before you continue to Google'])('stops safely on %s, without retaining a partial pool', async body => {
    const f = fixture([{ ids: ['a'], next: url(10) }, { ids: [], body, next: url(20) }]);
    await expect(f.run()).rejects.toThrow('Google people search is temporarily unavailable.');
    expect(f.stats()?.blocked).toBe(true); expect(f.page.goto).toHaveBeenCalledTimes(2);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('closes on HTTP and navigation failure', async () => {
    for (const failed of [{ ok: false }, { error: true }]) {
      const f = fixture([{ ids: [], ...failed }]); await expect(f.run()).rejects.toThrow('temporarily unavailable');
      expect(f.browser.close).toHaveBeenCalledTimes(1);
    }
  });
  it('closes a stalled browser on the crawl deadline', async () => {
    const f = fixture([{ ids: ['a'] }], { timeoutMs: 10 });
    let rejectNavigation: (error: Error) => void = () => undefined;
    f.page.goto.mockImplementation(() => new Promise((_resolve, reject) => { rejectNavigation = reject; }));
    f.browser.close.mockImplementation(async () => { rejectNavigation(Error('closed')); });
    await expect(f.run()).rejects.toThrow('temporarily unavailable');
    expect(f.stats()?.stopReason).toBe('timeout'); expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('allows only one active browser crawl per process', async () => {
    const f = fixture([{ ids: ['a'] }]);
    let resume: () => void = () => undefined;
    const ready = new Promise<void>(resolve => { resume = resolve; });
    f.launch.mockImplementation(async () => { await ready; return f.browser as unknown as Browser; });
    const first = f.run();
    await expect(f.provider.search(query)).rejects.toThrow('busy'); resume(); await first;
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('rejects experimental hybrid mixing without invoking either provider', async () => {
    const config = getEnv(); const old = config.WEB_SEARCH_PROVIDER; config.WEB_SEARCH_PROVIDER = 'playwright_google';
    const apify = { searchProfiles: vi.fn() };
    try { await expect(discoverProfiles({ companyName: 'Acme', jobTitles: ['Recruiter'], locations: [], maxResults: 10 }, {
      apify, mode: 'hybrid', target: 10, validate: async p => p
    })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' }); expect(apify.searchProfiles).not.toHaveBeenCalled(); }
    finally { config.WEB_SEARCH_PROVIDER = old; }
  });
});

describe('location evidence excludes prose', () => {
  it.each(['Manage your professional identity, build your network', 'Build and engage with your professional network, United States', 'Location: Manage your professional identity', 'Software Engineer, Abacus Insights'])("does not store %s", snippet => {
    expect(parseLinkedInSearchResult({ ...row('jane'), snippet })?.location).toBeNull();
  });
});
