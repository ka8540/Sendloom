import { describe, it, expect, vi } from 'vitest';
import { getEnv } from '@/lib/env';
import { createConfiguredWebSearchProvider } from './web-search-provider';
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
