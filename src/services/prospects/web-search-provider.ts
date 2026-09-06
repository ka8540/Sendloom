import { env } from "@/lib/env";
import { z } from "zod";

export type WebSearchResult = { title: string; url: string; snippet: string | null };
export type WebSearchOptions = { page?: number; count?: number; signal?: AbortSignal };
export interface WebSearchProvider {
  configured: boolean;
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}
export const WEB_SEARCH_TIMEOUT_MS = 8_000;
const row = z.object({ title: z.string().optional(), link: z.string().optional(), url: z.string().optional(),
  snippet: z.string().nullable().optional(), description: z.string().nullable().optional() });

/** Shared API client: email discovery retains its five-result default. No page fetching. */
export function createConfiguredWebSearchProvider(): WebSearchProvider | null {
  const provider = env.WEB_SEARCH_PROVIDER;
  if (provider !== "serper" && provider !== "brave") return null;
  const key = provider === "serper" ? env.SERPER_API_KEY : env.BRAVE_SEARCH_API_KEY;
  return {
    configured: Boolean(key),
    async search(query, options = {}) {
      if (!key) return [];
      const count = Math.max(1, Math.min(10, Math.floor(options.count ?? 5)));
      const page = Math.max(1, Math.min(3, Math.floor(options.page ?? 1)));
      const timeout = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
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
