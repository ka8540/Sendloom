import { describe, it, expect, vi } from 'vitest';
import { getEnv } from '@/lib/env';
import { createConfiguredWebSearchProvider, YouSearchProvider } from './web-search-provider';
import { createConfiguredEmailFormatSearchProvider } from './email-format-discovery-service';

describe('shared API transport', () => {
  it.each(['serper', 'brave'] as const)('keeps email defaults and supports bounded %s pagination', async provider => {
    const env = getEnv();
    const previous = { WEB_SEARCH_PROVIDER: env.WEB_SEARCH_PROVIDER, SERPER_API_KEY: env.SERPER_API_KEY, BRAVE_SEARCH_API_KEY: env.BRAVE_SEARCH_API_KEY };
    Object.assign(env, { WEB_SEARCH_PROVIDER: provider, SERPER_API_KEY: 'test-key', BRAVE_SEARCH_API_KEY: 'test-key' });
    try {
      const fetcher = vi.fn(async () => Response.json(provider === 'serper'
        ? { organic: [{ title: 'Title', link: 'https://example.test', snippet: 'Snippet' }] }
        : { web: { results: [{ title: 'Title', url: 'https://example.test', description: 'Snippet' }] } }));
      vi.stubGlobal('fetch', fetcher);
      const r = await createConfiguredEmailFormatSearchProvider()!.search('email format');
      expect(r).toEqual([{ title: 'Title', url: 'https://example.test', snippet: 'Snippet' }]);
      await createConfiguredWebSearchProvider()!.search('people', { page: 99, count: 999 });
      const [firstUrl, first] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
      const [lastUrl, last] = fetcher.mock.calls[1] as unknown as [URL, RequestInit];
      if (provider === 'serper') {
        expect(JSON.parse(first.body as string)).toMatchObject({ num: 5, page: 1 });
        expect(JSON.parse(last.body as string)).toMatchObject({ num: 10, page: 3 });
      } else {
        expect(firstUrl.searchParams.get('count')).toBe('5');
        expect(lastUrl.searchParams.get('count')).toBe('10');
        expect(lastUrl.searchParams.get('offset')).toBe('2');
      }
      expect(last.signal).toBeInstanceOf(AbortSignal);
    } finally { Object.assign(env, previous); }
  });
  it('rejects malformed result lists', async () => {
    const env = getEnv(); const provider = env.WEB_SEARCH_PROVIDER; const key = env.SERPER_API_KEY;
    env.WEB_SEARCH_PROVIDER = 'serper'; env.SERPER_API_KEY = 'test-key';
    try {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ organic: { secret: 'invalid' } })));
      await expect(createConfiguredWebSearchProvider()!.search('query')).rejects.toThrow();
    } finally { env.WEB_SEARCH_PROVIDER = provider; env.SERPER_API_KEY = key; }
  });
});

describe('You.com platform web search', () => {
  const stubYou = (payload: unknown) => vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json(payload));
  const lastBody = (fetcher: ReturnType<typeof stubYou>) =>
    JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string) as Record<string, unknown>;

  it('accepts WEB_SEARCH_PROVIDER=you and loads YDC_API_KEY from the process environment', async () => {
    const previous = { WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER, YDC_API_KEY: process.env.YDC_API_KEY };
    process.env.WEB_SEARCH_PROVIDER = 'YOU';
    process.env.YDC_API_KEY = 'process-key';
    vi.resetModules();
    try {
      const env = (await import('@/lib/env')).getEnv();
      expect(env.WEB_SEARCH_PROVIDER).toBe('you');
      expect(env.YDC_API_KEY).toBe('process-key');
    } finally {
      vi.resetModules();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it('treats an empty YDC_API_KEY as absent', async () => {
    const previous = process.env.YDC_API_KEY;
    process.env.YDC_API_KEY = '';
    vi.resetModules();
    try { expect((await import('@/lib/env')).getEnv().YDC_API_KEY).toBeUndefined(); }
    finally { vi.resetModules(); if (previous === undefined) delete process.env.YDC_API_KEY; else process.env.YDC_API_KEY = previous; }
  });
  it('is unconfigured without an API key and never calls fetch', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(new YouSearchProvider(undefined).configured).toBe(false);
    expect(new YouSearchProvider('   ').configured).toBe(false);
    await expect(new YouSearchProvider(undefined).search('query')).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('factory selects You.com only when WEB_SEARCH_PROVIDER=you', () => {
    const env = getEnv();
    const previous = { WEB_SEARCH_PROVIDER: env.WEB_SEARCH_PROVIDER, YDC_API_KEY: env.YDC_API_KEY };
    Object.assign(env, { WEB_SEARCH_PROVIDER: 'you', YDC_API_KEY: 'test-key' });
    try {
      const provider = createConfiguredWebSearchProvider();
      expect(provider).toBeInstanceOf(YouSearchProvider);
      expect(provider!.configured).toBe(true);
      expect(provider!.maxResultsPerRequest).toBe(100);
    } finally { Object.assign(env, previous); }
  });
  it('POSTs to the official endpoint with key auth, JSON content type, exact query, count, offset and domain filter', async () => {
    const fetcher = stubYou({ results: { web: [] } });
    vi.stubGlobal('fetch', fetcher);
    const query = 'site:linkedin.com/in "Abacus Insights" "Software Engineer" "United States"';
    await new YouSearchProvider('secret-key').search(query, { count: 25, page: 2, includeDomains: ['linkedin.com'] });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ydc-index.io/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-API-Key': 'secret-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ query, count: 25, offset: 1, include_domains: ['linkedin.com'] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('keeps the five-result default and bounds count and offset to the API range', async () => {
    const fetcher = stubYou({});
    vi.stubGlobal('fetch', fetcher);
    const provider = new YouSearchProvider('key');
    await provider.search('acme email format');
    await provider.search('q', { count: 999, page: 99 });
    await provider.search('q', { count: 0, page: 0 });
    expect(lastBody(fetcher)).toMatchObject({ count: 1, offset: 0 });
    const bodies = fetcher.mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(bodies[0]).toMatchObject({ count: 5, offset: 0 });
    expect(bodies[1]).toMatchObject({ count: 100, offset: 9 });
    expect(bodies.every(body => !('include_domains' in body))).toBe(true);
  });
  it('normalizes, dedupes and validates include_domains', async () => {
    const fetcher = stubYou({});
    vi.stubGlobal('fetch', fetcher);
    await new YouSearchProvider('key').search('q', { includeDomains: [' LinkedIn.COM ', 'linkedin.com', 'not a domain', '', 'https://evil.test'] });
    expect(lastBody(fetcher).include_domains).toEqual(['linkedin.com']);
  });
  it('normalizes web rows: first useful snippet, description fallback, skips unusable rows, ignores news', async () => {
    const fetcher = stubYou({ results: {
      web: [
        { title: 'A', url: 'https://a.test', snippets: ['', '  first useful snippet  ', 'second'] },
        { title: 'B', url: 'https://b.test', description: '  description fallback ' },
        { title: 'C', url: 'https://c.test' },
        { title: 'D', url: 'https://d.test', snippets: 'not-an-array', description: null },
        { title: '', url: 'https://missing-title.test', description: 'skip' },
        { title: 'Missing URL', description: 'skip' }
      ],
      news: [{ title: 'News', url: 'https://news.test', description: 'news must be ignored' }]
    }, related: [{ title: 'Related' }] });
    vi.stubGlobal('fetch', fetcher);
    expect(await new YouSearchProvider('key').search('q', { count: 25 })).toEqual([
      { title: 'A', url: 'https://a.test', snippet: 'first useful snippet' },
      { title: 'B', url: 'https://b.test', snippet: 'description fallback' },
      { title: 'C', url: 'https://c.test', snippet: null },
      { title: 'D', url: 'https://d.test', snippet: null }
    ]);
  });
  it.each([{}, { results: null }, { results: {} }, { results: { web: null } }, { results: { web: [] } }])('returns [] for unusable payload %j', async payload => {
    vi.stubGlobal('fetch', stubYou(payload));
    await expect(new YouSearchProvider('key').search('q')).resolves.toEqual([]);
  });
  it.each([401, 402, 403, 422, 500])('fails safely on HTTP %s without exposing the provider payload', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret provider body', { status })));
    const error = await new YouSearchProvider('secret-key').search('q').catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Web search request failed.');
  });
  it('fails safely on malformed payloads, network errors and aborts', async () => {
    vi.stubGlobal('fetch', stubYou({ results: { web: 'invalid' } }));
    await expect(new YouSearchProvider('key').search('q')).rejects.toThrow('Web search request failed.');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network secret'); }));
    await expect(new YouSearchProvider('key').search('q')).rejects.toThrow(/^Web search request failed\.$/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }));
    await expect(new YouSearchProvider('key').search('q')).rejects.toThrow(/^Web search request failed\.$/);
  });
  it('serves email-format discovery without any domain restriction', async () => {
    const env = getEnv();
    const previous = { WEB_SEARCH_PROVIDER: env.WEB_SEARCH_PROVIDER, YDC_API_KEY: env.YDC_API_KEY };
    Object.assign(env, { WEB_SEARCH_PROVIDER: 'you', YDC_API_KEY: 'email-key' });
    const fetcher = stubYou({ results: { web: [{ title: 'T', url: 'https://rocketreach.co/example', snippets: ['jane.doe@acme.test'] }] } });
    vi.stubGlobal('fetch', fetcher);
    try {
      const provider = createConfiguredEmailFormatSearchProvider();
      expect(provider).toBeInstanceOf(YouSearchProvider);
      expect(await provider!.search('acme email format')).toEqual([{ title: 'T', url: 'https://rocketreach.co/example', snippet: 'jane.doe@acme.test' }]);
      expect(lastBody(fetcher)).toEqual({ query: 'acme email format', count: 5, offset: 0 });
    } finally { Object.assign(env, previous); }
  });
});
