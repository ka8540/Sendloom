import "server-only";
import { z } from "zod";

import { env } from "@/lib/env";
import type { PublicSearchMetadata } from "@/services/prospects/public-profile-search-metadata";

export type FirecrawlFailure = "CONFIGURATION" | "AUTHENTICATION" | "QUOTA" | "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "PROVIDER" | "MALFORMED_RESPONSE";

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
  // Firecrawl documents 402 for insufficient credits/billing, without a separate Search error code.
  if (status === 402) return "QUOTA";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 504) return "TIMEOUT";
  return "PROVIDER";
}

/** Ordered per request, with no Redis/database selection state or credential diagnostics. */
function orderedApiKeys(pool: readonly string[] | undefined, singleKey: string | undefined): string[] {
  const keys = [...new Set((pool ?? []).map((key) => key.trim()).filter(Boolean))];
  return keys.length > 0 ? keys : singleKey?.trim() ? [singleKey.trim()] : [];
}

function keyFailoverReason(kind: FirecrawlFailure): "AUTH" | "RATE_LIMIT" | "QUOTA" | null {
  if (kind === "AUTHENTICATION") return "AUTH";
  if (kind === "RATE_LIMIT" || kind === "QUOTA") return kind;
  return null;
}

/** Server-side HTTP only; no SDK, result URL fetching, or page-scraping options. */
export class FirecrawlSearchProvider implements FirecrawlPeopleSearchProvider {
  readonly configured: boolean;
  private readonly apiKeys: readonly string[];
  constructor(private readonly options: {
    apiKeys?: readonly string[]; apiKey?: string; enabled?: boolean; timeoutMs?: number; maxResults?: number; fetcher?: typeof fetch;
  } = {}) {
    const credentialOverride = options.apiKeys !== undefined || options.apiKey !== undefined;
    this.apiKeys = orderedApiKeys(
      credentialOverride ? options.apiKeys : env.FIRECRAWL_API_KEYS,
      credentialOverride ? options.apiKey : env.FIRECRAWL_API_KEY
    );
    this.configured = Boolean((options.enabled ?? env.DISCOVER_FIRECRAWL_ENABLED) && this.apiKeys.length);
  }

  async search(query: string, options: FirecrawlRequestOptions = {}): Promise<FirecrawlSearchResponse> {
    if (!this.configured) throw new FirecrawlSearchError("CONFIGURATION");
    const remaining = options.deadlineAtMs === undefined ? Infinity : options.deadlineAtMs - Date.now();
    // Keep the parent cleanup reserve. Parent cancellation is not provider exhaustion/failure.
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (remaining <= 5_000) throw new DOMException("Parent deadline reached", "AbortError");
    const timeoutMs = Math.max(1, Math.floor(Math.min(this.options.timeoutMs ?? env.DISCOVER_FIRECRAWL_TIMEOUT_MS, remaining - 5_000)));
    const timeoutAtMs = Date.now() + timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const limit = Math.min(100, Math.max(1, Math.floor(this.options.maxResults ?? env.DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY)));
    const configuredKeyCount = this.apiKeys.length;
    let keyAttempts = 0;
    try {
      for (let slot = 0; slot < configuredKeyCount; slot += 1) {
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
        if (options.deadlineAtMs !== undefined && options.deadlineAtMs - Date.now() <= 5_000) {
          throw new DOMException("Parent deadline reached", "AbortError");
        }
        const requestTimeoutMs = slot === 0 ? timeoutMs : Math.floor(timeoutAtMs - Date.now());
        if (timeout.aborted || requestTimeoutMs <= 0) throw new FirecrawlSearchError("TIMEOUT");
        keyAttempts += 1;
        const response = await (this.options.fetcher ?? fetch)("https://api.firecrawl.dev/v2/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKeys[slot]}` },
          body: JSON.stringify({ query, limit, sources: ["web"], includeDomains: ["linkedin.com"], domainTools: false, highlights: false, timeout: requestTimeoutMs }),
          signal
        });
        if (!response.ok) {
          const failure = new FirecrawlSearchError(httpFailure(response.status), response.status);
          const reason = keyFailoverReason(failure.kind);
          if (!reason || slot + 1 === configuredKeyCount) throw failure;
          // Never retry this key or sleep for Retry-After. Only another configured key is eligible.
          await response.body?.cancel().catch(() => undefined);
          console.info(JSON.stringify({ event: "FIRECRAWL_KEY_FAILOVER", attemptedKeySlot: slot, nextKeySlot: slot + 1, reason, configuredKeyCount }));
          continue;
        }
        let payload: unknown;
        try { payload = await response.json(); }
        catch (error) {
          if (timeout.aborted || options.signal?.aborted) throw error;
          throw new FirecrawlSearchError("MALFORMED_RESPONSE", response.status);
        }
        const parsed = parseResponse(payload, limit);
        console.info(JSON.stringify({ event: "FIRECRAWL_REQUEST_COMPLETED", status: response.status, rawResultCount: parsed.rawResultCount, creditsUsed: parsed.creditsUsed,
          configuredKeyCount, keyAttempts, successfulKeySlot: slot, keyFailoverCount: keyAttempts - 1 }));
        return parsed;
      }
      throw new FirecrawlSearchError("CONFIGURATION");
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      if (options.deadlineAtMs !== undefined && options.deadlineAtMs - Date.now() <= 5_000) {
        throw new DOMException("Parent deadline reached", "AbortError");
      }
      const safeError = error instanceof FirecrawlSearchError ? error
        : timeout.aborted || (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name))
          ? new FirecrawlSearchError("TIMEOUT") : new FirecrawlSearchError("NETWORK");
      console.info(JSON.stringify({ event: "FIRECRAWL_REQUEST_FAILED", status: safeError.status, kind: safeError.kind,
        configuredKeyCount, keyAttempts, keyFailoverCount: Math.max(0, keyAttempts - 1) }));
      throw safeError;
    }
  }
}

export function firecrawlFailureEvent(error: unknown):
  | "FIRECRAWL_AUTH_ERROR" | "FIRECRAWL_RATE_LIMIT" | "FIRECRAWL_TIMEOUT" | "FIRECRAWL_PROVIDER_ERROR" | "FIRECRAWL_MALFORMED_RESPONSE" {
  const kind = error instanceof FirecrawlSearchError ? error.kind : null;
  if (kind === "CONFIGURATION" || kind === "AUTHENTICATION") return "FIRECRAWL_AUTH_ERROR";
  if (kind === "RATE_LIMIT" || kind === "QUOTA") return "FIRECRAWL_RATE_LIMIT";
  if (kind === "TIMEOUT") return "FIRECRAWL_TIMEOUT";
  if (kind === "MALFORMED_RESPONSE") return "FIRECRAWL_MALFORMED_RESPONSE";
  return "FIRECRAWL_PROVIDER_ERROR";
}
