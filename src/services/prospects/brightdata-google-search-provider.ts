import { env } from '@/lib/env';
import type { WebSearchOptions, WebSearchProvider, WebSearchResult } from './web-search-provider';

export type BrightDataFailure = 'CONFIGURATION' | 'AUTHENTICATION' | 'HTTP' | 'TRANSIENT' | 'MALFORMED_RESPONSE';
export class BrightDataSearchError extends Error {
  constructor(readonly kind: BrightDataFailure) { super('Web search request failed.'); this.name = 'BrightDataSearchError'; }
}
/** One parsed Google SERP page. Pagination and qualification belong to Discover. */
export class BrightDataGoogleSearchProvider implements WebSearchProvider {
  readonly configured: boolean;
  readonly maxResultsPerRequest = 10;
  readonly peopleQueryStrategy = 'single_role_union' as const;
  readonly pagination = { maxPages: env.DISCOVER_PUBLIC_MAX_PAGES ?? 10, maxResults: env.DISCOVER_PUBLIC_MAX_RESULTS ?? 100 };
  constructor(private readonly apiKey = env.BRIGHTDATA_API_KEY, private readonly zone = env.BRIGHTDATA_SERP_ZONE) {
    this.configured = Boolean(apiKey?.trim() && zone?.trim());
  }
  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    if (!this.configured) throw new BrightDataSearchError('CONFIGURATION');
    const page = options.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > this.pagination.maxPages) return [];
    const googleUrl = new URL('https://www.google.com/search');
    googleUrl.search = new URLSearchParams({ q: query, hl: 'en', gl: 'us', pws: '0', udm: '14',
      brd_json: 'json', start: String((page - 1) * 10) }).toString();
    try {
      const timeout = AbortSignal.timeout(30_000);
      const response = await fetch('https://api.brightdata.com/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ zone: this.zone, url: googleUrl.toString(), format: 'raw' }),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok) throw new BrightDataSearchError(response.status === 401 || response.status === 403
        ? 'AUTHENTICATION' : response.status === 429 || response.status >= 500 ? 'TRANSIENT' : 'HTTP');
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new BrightDataSearchError('MALFORMED_RESPONSE'); }
      if (!payload || typeof payload !== 'object' || !('organic' in payload) || !Array.isArray(payload.organic))
        throw new BrightDataSearchError('MALFORMED_RESPONSE');
      return payload.organic.slice(0, 10).map((row: unknown) => {
        if (!row || typeof row !== 'object' || !('link' in row) || typeof row.link !== 'string' ||
          !('title' in row) || typeof row.title !== 'string') throw new BrightDataSearchError('MALFORMED_RESPONSE');
        return { url: row.link, title: row.title, snippet: 'description' in row && typeof row.description === 'string' ? row.description : null };
      });
    } catch (error) {
      if (error instanceof BrightDataSearchError) throw error;
      throw new BrightDataSearchError('TRANSIENT');
    }
  }
}
