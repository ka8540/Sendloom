import "server-only";
import { z } from "zod";

import { env } from "@/lib/env";
import type { PublicSearchMetadata } from "@/services/prospects/public-profile-search-metadata";

export type FirecrawlFailure = "CONFIGURATION" | "AUTHENTICATION" | "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "PROVIDER" | "MALFORMED_RESPONSE";

/** Contains only a fixed message and safe categories; provider error bodies are never retained. */
export class FirecrawlSearchError extends Error {
  constructor(readonly kind: FirecrawlFailure, readonly status: number | null = null) {
    super("Firecrawl public search failed.");
    this.name = "FirecrawlSearchError";
  }
}

export type FirecrawlSearchResponse = {
  results: Array<PublicSearchMetadata & { position: number | null }>;
  rawResultCount: number;
  creditsUsed: number | null;
};

export type FirecrawlRequestOptions = { signal?: AbortSignal; deadlineAtMs?: number };
export interface FirecrawlPeopleSearchProvider {
  readonly configured: boolean;
  search(query: string, options?: FirecrawlRequestOptions): Promise<FirecrawlSearchResponse>;
}

const envelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ web: z.array(z.unknown()) }),
  creditsUsed: z.number().finite().nonnegative().nullish()
});
const resultSchema = z.object({
  url: z.string().trim().min(1).max(4_096),
  title: z.string().trim().min(1).transform((value) => value.slice(0, 500)),
  description: z.string().trim().transform((value) => value.slice(0, 2_000)),
  position: z.number().finite().nonnegative().nullish()
});

function parseResponse(payload: unknown, limit: number): FirecrawlSearchResponse {
  if (payload && typeof payload === "object" && (payload as { success?: unknown }).success === false) {
    throw new FirecrawlSearchError("PROVIDER", 200);
  }
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) throw new FirecrawlSearchError("MALFORMED_RESPONSE", 200);
  // Consume only data.web. Indexes, tools, images, news, and scrape content are discarded.
  const rows = parsed.data.data.web.slice(0, limit);
  const results: FirecrawlSearchResponse["results"] = [];
  for (const row of rows) {
    const entry = resultSchema.safeParse(row);
    if (entry.success) results.push({ ...entry.data, position: entry.data.position ?? null });
  }
  if (rows.length > 0 && results.length === 0) throw new FirecrawlSearchError("MALFORMED_RESPONSE", 200);
  return { results, rawResultCount: rows.length, creditsUsed: parsed.data.creditsUsed ?? null };
}

function httpFailure(status: number): FirecrawlFailure {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 504) return "TIMEOUT";
  return "PROVIDER";
}

/** Server-side HTTP only; no SDK, result URL fetching, or page-scraping options. */
export class FirecrawlSearchProvider implements FirecrawlPeopleSearchProvider {
  readonly configured: boolean;
  constructor(private readonly options: {
    apiKey?: string; enabled?: boolean; timeoutMs?: number; maxResults?: number; fetcher?: typeof fetch;
  } = {}) {
    this.configured = Boolean((options.enabled ?? env.DISCOVER_FIRECRAWL_ENABLED) && (options.apiKey ?? env.FIRECRAWL_API_KEY)?.trim());
  }

  async search(query: string, options: FirecrawlRequestOptions = {}): Promise<FirecrawlSearchResponse> {
    const apiKey = (this.options.apiKey ?? env.FIRECRAWL_API_KEY)?.trim();
    if (!this.configured || !apiKey) throw new FirecrawlSearchError("CONFIGURATION");
    const remaining = options.deadlineAtMs === undefined ? Infinity : options.deadlineAtMs - Date.now();
    // Keep the parent cleanup reserve. Parent cancellation is not provider exhaustion/failure.
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (remaining <= 5_000) throw new DOMException("Parent deadline reached", "AbortError");
    const timeoutMs = Math.max(1, Math.floor(Math.min(this.options.timeoutMs ?? env.DISCOVER_FIRECRAWL_TIMEOUT_MS, remaining - 5_000)));
    const timeout = AbortSignal.timeout(timeoutMs);
    const limit = Math.min(100, Math.max(1, Math.floor(this.options.maxResults ?? env.DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY)));
    try {
      const response = await (this.options.fetcher ?? fetch)("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, limit, sources: ["web"], includeDomains: ["linkedin.com"], domainTools: false, highlights: false, timeout: timeoutMs }),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok) throw new FirecrawlSearchError(httpFailure(response.status), response.status);
      let payload: unknown;
      try { payload = await response.json(); }
      catch (error) {
        if (timeout.aborted || options.signal?.aborted) throw error;
        throw new FirecrawlSearchError("MALFORMED_RESPONSE", response.status);
      }
      const parsed = parseResponse(payload, limit);
      console.info(JSON.stringify({ event: "FIRECRAWL_REQUEST_COMPLETED", status: response.status, rawResultCount: parsed.rawResultCount, creditsUsed: parsed.creditsUsed }));
      return parsed;
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      const safeError = error instanceof FirecrawlSearchError ? error
        : timeout.aborted || (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name))
          ? new FirecrawlSearchError("TIMEOUT") : new FirecrawlSearchError("NETWORK");
      console.info(JSON.stringify({ event: "FIRECRAWL_REQUEST_FAILED", status: safeError.status, kind: safeError.kind }));
      throw safeError;
    }
  }
}

export function firecrawlFailureEvent(error: unknown):
  | "FIRECRAWL_AUTH_ERROR" | "FIRECRAWL_RATE_LIMIT" | "FIRECRAWL_TIMEOUT" | "FIRECRAWL_PROVIDER_ERROR" | "FIRECRAWL_MALFORMED_RESPONSE" {
  const kind = error instanceof FirecrawlSearchError ? error.kind : null;
  if (kind === "CONFIGURATION" || kind === "AUTHENTICATION") return "FIRECRAWL_AUTH_ERROR";
  if (kind === "RATE_LIMIT") return "FIRECRAWL_RATE_LIMIT";
  if (kind === "TIMEOUT") return "FIRECRAWL_TIMEOUT";
  if (kind === "MALFORMED_RESPONSE") return "FIRECRAWL_MALFORMED_RESPONSE";
  return "FIRECRAWL_PROVIDER_ERROR";
}
