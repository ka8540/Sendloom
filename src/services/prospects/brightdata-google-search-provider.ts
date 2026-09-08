import { env } from '@/lib/env';
import type { WebSearchOptions, WebSearchProvider, WebSearchResult } from './web-search-provider';
import { inspectGoogleResultRedirect } from './linkedin-profile-url';

export type BrightDataFailure = 'CONFIGURATION' | 'AUTHENTICATION' | 'HTTP' | 'TRANSIENT' | 'MALFORMED_RESPONSE';
export class BrightDataSearchError extends Error {
  constructor(readonly kind: BrightDataFailure) { super('Web search request failed.'); this.name = 'BrightDataSearchError'; }
}

const ORGANIC_URL_FIELDS = ['link', 'url', 'href', 'target_url'] as const;
const DISPLAYED_URL_FIELDS = ['display_link', 'displayed_link', 'displayed_url', 'source'] as const;
const GOOGLE_REDIRECT_TIMEOUT_MS = 5_000;
const GOOGLE_REDIRECT_CONCURRENCY = 4;

function textField(row: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Known Bright Data organic URL fields, normalized at the provider boundary. */
export function getOrganicResultUrl(row: unknown): {
  rawUrl: string | null;
  displayedUrl: string | null;
} {
  if (!row || typeof row !== 'object') return { rawUrl: null, displayedUrl: null };
  const record = row as Record<string, unknown>;
  const candidates = ORGANIC_URL_FIELDS.flatMap(field => {
    const value = record[field];
    return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  });
  const preferred = candidates.find(value => /^https?:\/\//i.test(value) && !inspectGoogleResultRedirect(value))
    ?? candidates.find(value => Boolean(inspectGoogleResultRedirect(value)?.destination))
    ?? candidates[0] ?? null;
  return { rawUrl: preferred, displayedUrl: textField(record, DISPLAYED_URL_FIELDS) };
}

function safeRedirectLocation(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

async function normalizeOrganicUrl(rawUrl: string | null, options: WebSearchOptions): Promise<{
  url: string | null;
  source: 'DIRECT' | 'GOOGLE_REDIRECT';
}> {
  if (!rawUrl) return { url: null, source: 'DIRECT' };
  const wrapper = inspectGoogleResultRedirect(rawUrl);
  if (!wrapper) return { url: rawUrl, source: 'DIRECT' };
  if (wrapper.destination) return { url: wrapper.destination, source: 'GOOGLE_REDIRECT' };
  try {
    const timeout = AbortSignal.timeout(GOOGLE_REDIRECT_TIMEOUT_MS);
    const response = await fetch(wrapper.wrapperUrl, {
      method: 'GET', redirect: 'manual',
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
    });
    if (response.status < 300 || response.status >= 400) return { url: rawUrl, source: 'GOOGLE_REDIRECT' };
    return { url: safeRedirectLocation(response.headers.get('location')) ?? rawUrl, source: 'GOOGLE_REDIRECT' };
  } catch {
    return { url: rawUrl, source: 'GOOGLE_REDIRECT' };
  }
}

async function mapOrganicRows(rows: unknown[], options: WebSearchOptions): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(GOOGLE_REDIRECT_CONCURRENCY, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      if (!row || typeof row !== 'object' || !('title' in row) || typeof row.title !== 'string')
        throw new BrightDataSearchError('MALFORMED_RESPONSE');
      const { rawUrl, displayedUrl } = getOrganicResultUrl(row);
      const normalized = await normalizeOrganicUrl(rawUrl, options);
      results[index] = { url: normalized.url ?? '', rawUrl, urlSource: normalized.source, displayedUrl, title: row.title,
        snippet: 'description' in row && typeof row.description === 'string' ? row.description : null };
    }
  }));
  return results;
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
      return await mapOrganicRows(payload.organic.slice(0, 10), options);
    } catch (error) {
      if (error instanceof BrightDataSearchError) throw error;
      throw new BrightDataSearchError('TRANSIENT');
    }
  }
}
