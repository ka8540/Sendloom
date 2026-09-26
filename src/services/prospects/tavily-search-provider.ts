import { env } from "@/lib/env";

export type TavilyFailure =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "USAGE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER"
  | "MALFORMED_RESPONSE";

export class TavilySearchError extends Error {
  readonly status: number | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;

  constructor(
    readonly kind: TavilyFailure,
    details: {
      status?: number | null;
      errorType?: string | null;
      errorCode?: string | null;
    } = {}
  ) {
    super("Tavily public search failed.");
    this.name = "TavilySearchError";
    this.status = details.status ?? null;
    this.errorType = details.errorType ?? null;
    this.errorCode = details.errorCode ?? null;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResponse(payload: unknown, status: number): TavilySearchResponse {
  if (!payload || typeof payload !== "object") {
    throw new TavilySearchError("MALFORMED_RESPONSE", { status });
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.query !== "string" || !Array.isArray(record.results)) {
    throw new TavilySearchError("MALFORMED_RESPONSE", { status });
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
  if (record.results.length > 0 && results.length === 0) {
    throw new TavilySearchError("MALFORMED_RESPONSE", { status });
  }
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

function safeIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(candidate) ? candidate : null;
}

function errorMetadataFromRecord(record: Record<string, unknown>): {
  errorType: string | null;
  errorCode: string | null;
} {
  return {
    errorType: safeIdentifier(record.error_type) ?? safeIdentifier(record.errorType) ?? safeIdentifier(record.type),
    errorCode: safeIdentifier(record.error_code) ?? safeIdentifier(record.errorCode) ?? safeIdentifier(record.code)
  };
}

function safeErrorMetadata(payload: unknown): {
  errorType: string | null;
  errorCode: string | null;
} {
  if (!payload || typeof payload !== "object") return { errorType: null, errorCode: null };
  const record = payload as Record<string, unknown>;
  const topLevel = errorMetadataFromRecord(record);
  if (topLevel.errorType || topLevel.errorCode) return topLevel;

  const detail = record.detail;
  const detailRecord = Array.isArray(detail)
    ? detail.find((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : detail && typeof detail === "object"
      ? detail as Record<string, unknown>
      : null;
  if (!detailRecord) return topLevel;
  const detailMetadata = errorMetadataFromRecord(detailRecord);
  if (detailMetadata.errorType || detailMetadata.errorCode) return detailMetadata;

  const nestedError = detailRecord.error;
  return nestedError && typeof nestedError === "object"
    ? errorMetadataFromRecord(nestedError as Record<string, unknown>)
    : detailMetadata;
}

async function safeHttpErrorMetadata(response: Response): Promise<{
  errorType: string | null;
  errorCode: string | null;
}> {
  try {
    return safeErrorMetadata(await response.json());
  } catch {
    return { errorType: null, errorCode: null };
  }
}

function httpFailureKind(status: number): TavilyFailure {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 432 || status === 433) return "USAGE_LIMIT";
  return "PROVIDER";
}

function logRequestFailed(error: TavilySearchError): void {
  console.info(JSON.stringify({
    event: "TAVILY_REQUEST_FAILED",
    status: error.status,
    kind: error.kind,
    ...(error.errorType ? { errorType: error.errorType } : {}),
    ...(error.errorCode ? { errorCode: error.errorCode } : {})
  }));
}

function logRequestCompleted(response: TavilySearchResponse): void {
  console.info(JSON.stringify({
    event: "TAVILY_REQUEST_COMPLETED",
    status: 200,
    rawResultCount: response.rawResultCount,
    creditsUsed: response.creditsUsed,
    responseTimeSeconds: response.responseTimeSeconds
  }));
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
    if (!this.configured || !apiKey) {
      const error = new TavilySearchError("CONFIGURATION");
      logRequestFailed(error);
      throw error;
    }
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
          include_domains: ["linkedin.com/in"],
          include_domains_mode: "restrict",
          include_usage: true
        }),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok) {
        const metadata = await safeHttpErrorMetadata(response);
        throw new TavilySearchError(httpFailureKind(response.status), {
          status: response.status,
          ...metadata
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TavilySearchError("MALFORMED_RESPONSE", { status: response.status });
      }
      const parsed = parseResponse(payload, response.status);
      logRequestCompleted(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof TavilySearchError) {
        logRequestFailed(error);
        throw error;
      }
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        if (options.signal?.aborted) {
          console.info(JSON.stringify({ event: "TAVILY_REQUEST_FAILED", status: null, kind: "ABORTED" }));
          throw error;
        }
        const timeoutError = new TavilySearchError("TIMEOUT");
        logRequestFailed(timeoutError);
        throw timeoutError;
      }
      const networkError = new TavilySearchError("NETWORK");
      logRequestFailed(networkError);
      throw networkError;
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
