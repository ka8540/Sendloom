import { env } from "@/lib/env";
import { z } from "zod";

export type WebSearchResult = { title: string; url: string; snippet: string | null };
export type WebSearchOptions = {
  /** Provider-neutral, one-based result window. */
  page?: number;
  count?: number;
  /** Optional allowlist for APIs supporting domain filters; always validate returned URLs. */
  includeDomains?: readonly string[];
  signal?: AbortSignal;
};
export interface WebSearchProvider {
  configured: boolean;
  /** Lets callers choose an economical batch without knowing the provider. */
  readonly maxResultsPerRequest?: number;
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}
export const WEB_SEARCH_TIMEOUT_MS = 8_000;
const row = z.object({ title: z.string().optional(), link: z.string().optional(), url: z.string().optional(),
  snippet: z.string().nullable().optional(), description: z.string().nullable().optional() });

const YOU_SEARCH_ENDPOINT = "https://ydc-index.io/v1/search";
const YOU_MAX_COUNT = 100;
const YOU_MAX_OFFSET = 9;
const MAX_INCLUDED_DOMAINS = 20;
const youPayload = z.object({
  results: z.object({ web: z.array(z.unknown()).nullish() }).nullish()
});
const youWebRow = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  description: z.unknown().optional(),
  snippets: z.unknown().optional()
});

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

function requestSignal(options: WebSearchOptions): AbortSignal {
  const timeout = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

function usefulText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

/** Indexed web snippets only. No extraction, livecrawl or profile-page fetching. */
export class YouSearchProvider implements WebSearchProvider {
  readonly configured: boolean;
  readonly maxResultsPerRequest = YOU_MAX_COUNT;

  constructor(private readonly apiKey: string | undefined = env.YDC_API_KEY) {
    this.configured = Boolean(apiKey?.trim());
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    if (!this.configured) return [];
    // Email-format discovery keeps its five-result default; people explicitly request 25.
    const count = boundedInteger(options.count, 5, 1, YOU_MAX_COUNT);
    const offset = boundedInteger(options.page, 1, 1, YOU_MAX_OFFSET + 1) - 1;
    const includeDomains = [...new Set((options.includeDomains ?? [])
      .map(domain => domain.trim().toLowerCase())
      .filter(domain => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)))]
      .slice(0, MAX_INCLUDED_DOMAINS);
    try {
      const response = await fetch(YOU_SEARCH_ENDPOINT, {
        method: "POST",
        headers: { "X-API-Key": this.apiKey!, "Content-Type": "application/json" },
        signal: requestSignal(options),
        body: JSON.stringify({ query, count, offset,
          ...(includeDomains.length ? { include_domains: includeDomains } : {}) })
      });
      if (!response.ok) throw new Error("Web search request failed.");
      const payload = youPayload.parse(await response.json());
      const results: WebSearchResult[] = [];
      for (const raw of (payload.results?.web ?? []).slice(0, count)) {
        const parsed = youWebRow.safeParse(raw);
        if (!parsed.success) continue;
        const item = parsed.data;
        const snippet = (Array.isArray(item.snippets) ? item.snippets.map(usefulText).find(Boolean) : null)
          ?? usefulText(item.description);
        results.push({ title: item.title, url: item.url, snippet });
      }
      return results;
    } catch {
      // HTTP errors, invalid JSON, network errors and aborts never expose provider payloads.
      throw new Error("Web search request failed.");
    }
  }
}

/** Shared API client: email discovery retains its five-result default. No page fetching. */
export function createConfiguredWebSearchProvider(): WebSearchProvider | null {
  const provider = env.WEB_SEARCH_PROVIDER;
  if (provider === "you") return new YouSearchProvider();
  if (provider !== "serper" && provider !== "brave") return null;
  const key = provider === "serper" ? env.SERPER_API_KEY : env.BRAVE_SEARCH_API_KEY;
  return {
    configured: Boolean(key),
    maxResultsPerRequest: 10,
    async search(query, options = {}) {
      if (!key) return [];
      const count = Math.max(1, Math.min(10, Math.floor(options.count ?? 5)));
      const page = Math.max(1, Math.min(3, Math.floor(options.page ?? 1)));
      const signal = requestSignal(options);
      const url = new URL(provider === "serper" ? "https://google.serper.dev/search" : "https://api.search.brave.com/res/v1/web/search");
      if (provider === "brave") {
        url.searchParams.set("q", query); url.searchParams.set("count", String(count));
        url.searchParams.set("offset", String(page - 1));
      }
      const response = await fetch(url, provider === "serper" ? {
        method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ q: query, num: count, page })
      } : { signal, headers: { accept: "application/json", "x-subscription-token": key } });
      if (!response.ok) throw new Error("Web search request failed.");
      const payload = z.object({ organic: z.array(row).optional(), web: z.object({ results: z.array(row).optional() }).optional() }).parse(await response.json());
      return (provider === "serper" ? payload.organic ?? [] : payload.web?.results ?? []).slice(0, count)
        .filter(r => Boolean(provider === "serper" ? r.link : r.url))
        .map(r => ({ title: r.title ?? "Search result", url: (provider === "serper" ? r.link : r.url)!,
          snippet: (provider === "serper" ? r.snippet : r.description) ?? null }));
    }
  };
}
