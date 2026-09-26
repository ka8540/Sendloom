import { env } from "@/lib/env";

export type TavilyFailure =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "USAGE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER"
  | "MALFORMED_RESPONSE";

export class TavilySearchError extends Error {
  constructor(readonly kind: TavilyFailure) {
    super("Tavily public search failed.");
    this.name = "TavilySearchError";
  }
}

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number | null;
};

export type TavilySearchResponse = {
  results: TavilySearchResult[];
  rawResultCount: number;
  responseTimeSeconds: number | null;
  creditsUsed: number | null;
};

export interface TavilyPeopleSearchProvider {
  readonly configured: boolean;
  search(query: string, options?: { signal?: AbortSignal }): Promise<TavilySearchResponse>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResponse(payload: unknown): TavilySearchResponse {
  if (!payload || typeof payload !== "object") throw new TavilySearchError("MALFORMED_RESPONSE");
  const record = payload as Record<string, unknown>;
  if (typeof record.query !== "string" || !Array.isArray(record.results)) {
    throw new TavilySearchError("MALFORMED_RESPONSE");
  }
  const results: TavilySearchResult[] = [];
  for (const item of record.results) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || typeof row.title !== "string" || typeof row.content !== "string") continue;
    results.push({
      url: row.url.trim(),
      title: row.title.trim().slice(0, 500),
      content: row.content.trim().slice(0, 2_000),
      score: finiteNumber(row.score)
    });
  }
  if (record.results.length > 0 && results.length === 0) throw new TavilySearchError("MALFORMED_RESPONSE");
  const usage = record.usage && typeof record.usage === "object"
    ? record.usage as Record<string, unknown>
    : null;
  return {
    results,
    rawResultCount: record.results.length,
    responseTimeSeconds: finiteNumber(record.response_time),
    creditsUsed: finiteNumber(usage?.credits)
  };
}

export class TavilySearchProvider implements TavilyPeopleSearchProvider {
  readonly configured: boolean;

  constructor(private readonly options: {
    apiKey?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maxResults?: number;
    searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
    enabled?: boolean;
  } = {}) {
    this.configured = Boolean(
      (options.enabled ?? env.DISCOVER_TAVILY_ENABLED) &&
      (options.apiKey ?? env.TAVILY_API_KEY)?.trim()
    );
  }

  async search(query: string, options: { signal?: AbortSignal } = {}): Promise<TavilySearchResponse> {
    const apiKey = (this.options.apiKey ?? env.TAVILY_API_KEY)?.trim();
    if (!this.configured || !apiKey) throw new TavilySearchError("CONFIGURATION");
    try {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? env.DISCOVER_TAVILY_TIMEOUT_MS);
      const response = await (this.options.fetcher ?? fetch)("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          query,
          topic: "general",
          search_depth: this.options.searchDepth ?? env.DISCOVER_TAVILY_SEARCH_DEPTH,
          max_results: this.options.maxResults ?? env.DISCOVER_TAVILY_MAX_RESULTS_PER_QUERY,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_domains: ["linkedin.com"],
          include_domains_mode: "restrict",
          include_usage: true
        }),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new TavilySearchError("AUTHENTICATION");
        if (response.status === 429) throw new TavilySearchError("RATE_LIMIT");
        if (response.status === 432 || response.status === 433) throw new TavilySearchError("USAGE_LIMIT");
        throw new TavilySearchError("PROVIDER");
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TavilySearchError("MALFORMED_RESPONSE");
      }
      return parseResponse(payload);
    } catch (error) {
      if (error instanceof TavilySearchError) throw error;
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        if (options.signal?.aborted) throw error;
        throw new TavilySearchError("TIMEOUT");
      }
      throw new TavilySearchError("PROVIDER");
    }
  }
}

export function tavilyFailureEvent(error: unknown):
  | "TAVILY_AUTH_ERROR"
  | "TAVILY_RATE_LIMIT"
  | "TAVILY_USAGE_LIMIT"
  | "TAVILY_TIMEOUT"
  | "TAVILY_PROVIDER_ERROR"
  | "TAVILY_MALFORMED_RESPONSE" {
  const kind = (error as { kind?: TavilyFailure })?.kind;
  if (kind === "CONFIGURATION" || kind === "AUTHENTICATION") return "TAVILY_AUTH_ERROR";
  if (kind === "RATE_LIMIT") return "TAVILY_RATE_LIMIT";
  if (kind === "USAGE_LIMIT") return "TAVILY_USAGE_LIMIT";
  if (kind === "TIMEOUT") return "TAVILY_TIMEOUT";
  if (kind === "MALFORMED_RESPONSE") return "TAVILY_MALFORMED_RESPONSE";
  return "TAVILY_PROVIDER_ERROR";
}
