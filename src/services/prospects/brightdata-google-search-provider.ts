import { env } from "@/lib/env";
import { inspectGoogleResultRedirect } from "@/services/prospects/linkedin-profile-url";

export type BrightDataFailure = "CONFIGURATION" | "AUTHENTICATION" | "TIMEOUT" | "PROVIDER" | "MALFORMED_RESPONSE";

/** Safe parsing/transport stage for diagnostics; never carries provider content. */
export type BrightDataFailureStage = "HTTP_ERROR" | "JSON_PARSE" | "ORGANIC_ARRAY_MISSING" | "NETWORK" | "TIMEOUT";

export type BrightResponseBodyClassification =
  | "JSON"
  | "HTML"
  | "EMPTY"
  | "JSON_LOOKING_INVALID"
  | "TEXT"
  | "UNKNOWN";

type BrightTransientBodyReason = "HTML_BODY" | "EMPTY_BODY" | "INVALID_JSON" | "NON_JSON_BODY";

export const MAX_BRIGHT_TRANSIENT_ATTEMPTS_PER_PAGE = 2;

export class BrightDataSearchError extends Error {
  readonly status: number | null;
  readonly stage: BrightDataFailureStage | null;

  constructor(
    readonly kind: BrightDataFailure,
    details: { status?: number | null; stage?: BrightDataFailureStage } = {}
  ) {
    super("Bright Data public search failed.");
    this.name = "BrightDataSearchError";
    this.status = details.status ?? null;
    this.stage = details.stage ?? null;
  }
}

function logRequestFailed(error: BrightDataSearchError): void {
  console.info(JSON.stringify({
    event: "BRIGHT_REQUEST_FAILED",
    status: error.status,
    kind: error.kind,
    ...(error.stage ? { stage: error.stage } : {})
  }));
}

function logRequestRetry(input: {
  status: number;
  page: number;
  attempt: number;
  reason: BrightTransientBodyReason;
}): void {
  console.info(JSON.stringify({ event: "BRIGHT_REQUEST_RETRY", ...input }));
}

export type BrightOrganicResult = {
  title: string;
  url: string;
  rawUrl: string | null;
  displayedUrl: string | null;
  snippet: string | null;
  /** Sanitized public text only; the raw provider row is never retained. */
  evidence: string[];
};

export type BrightDataPage = {
  results: BrightOrganicResult[];
  /** Count before row sanitization, used for terminal-page decisions. */
  rawOrganicResults: number;
  page: number;
  exhausted: boolean;
};

export interface BrightDataPeopleSearchProvider {
  readonly configured: boolean;
  search(query: string, options: { page: number; requestedLocations: readonly string[]; signal?: AbortSignal }): Promise<BrightDataPage>;
}

const ORGANIC_URL_FIELDS = ["link", "url", "href", "target_url"] as const;
const DISPLAYED_URL_FIELDS = ["display_link", "displayed_link", "displayed_url", "source", "breadcrumb"] as const;
const EVIDENCE_FIELDS = [
  "title",
  "description",
  "snippet",
  "display_link",
  "displayed_link",
  "displayed_url",
  "breadcrumb",
  "extensions",
  "rich_snippet",
  "richSnippet"
] as const;
const PAGE_SIZE = 10;

export function classifyBrightResponseBody(
  text: string,
  contentType: string | null
): BrightResponseBodyClassification {
  const trimmed = text.trim();
  if (!trimmed) return "EMPTY";

  const prefix = trimmed.slice(0, 512).toLowerCase();
  if (trimmed.startsWith("<")) return "HTML";

  const jsonLooking = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (jsonLooking) {
    try {
      JSON.parse(trimmed);
      return "JSON";
    } catch {
      return "JSON_LOOKING_INVALID";
    }
  }

  if (
    prefix.includes("<!doctype html") ||
    prefix.includes("<html") ||
    prefix.includes("<head") ||
    prefix.includes("<body")
  ) {
    return "HTML";
  }

  const declaredJson = contentType?.toLowerCase().includes("json") ?? false;
  if (declaredJson) {
    try {
      JSON.parse(trimmed);
      return "JSON";
    } catch {
      return "JSON_LOOKING_INVALID";
    }
  }

  if (contentType?.toLowerCase().startsWith("text/")) return "TEXT";
  return "UNKNOWN";
}

function transientBodyReason(classification: Exclude<BrightResponseBodyClassification, "JSON">): BrightTransientBodyReason {
  if (classification === "HTML") return "HTML_BODY";
  if (classification === "EMPTY") return "EMPTY_BODY";
  if (classification === "JSON_LOOKING_INVALID") return "INVALID_JSON";
  return "NON_JSON_BODY";
}

function textField(row: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function evidenceStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return value.trim() ? [value.trim().slice(0, 500)] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => evidenceStrings(entry, depth + 1)).slice(0, 20);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([, entry]) => evidenceStrings(entry, depth + 1))
    .slice(0, 20);
}

function getOrganicResultUrl(row: Record<string, unknown>): { rawUrl: string | null; displayedUrl: string | null } {
  const candidates = ORGANIC_URL_FIELDS.flatMap((field) => {
    const value = row[field];
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
  const preferred = candidates.find((value) => /^https?:\/\//i.test(value) && !inspectGoogleResultRedirect(value))
    ?? candidates.find((value) => Boolean(inspectGoogleResultRedirect(value)?.destination))
    ?? candidates[0]
    ?? null;
  return { rawUrl: preferred, displayedUrl: textField(row, DISPLAYED_URL_FIELDS) };
}

function normalizeOrganicUrl(rawUrl: string | null): string {
  if (!rawUrl) return "";
  const wrapper = inspectGoogleResultRedirect(rawUrl);
  return wrapper?.destination ?? rawUrl;
}

function organicRows(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.organic)) return record.organic;
  if (record.result && typeof record.result === "object" && Array.isArray((record.result as Record<string, unknown>).organic)) {
    return (record.result as Record<string, unknown>).organic as unknown[];
  }
  if (typeof record.body === "string") {
    try {
      return organicRows(JSON.parse(record.body));
    } catch {
      return null;
    }
  }
  return null;
}

const SHAPE_KEY_ALLOWLIST = new Set([
  "organic",
  "result",
  "body",
  "pagination",
  "general",
  "error",
  "status",
  "html",
  "knowledge",
  "images",
  "videos",
  "news",
  "related",
  "related_searches",
  "local",
  "shopping"
]);

function safeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Structural metadata only: types, counts, allowlisted key names. Never provider values. */
function describeBrightResponseShape(payload: unknown): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    topLevelType: payload === undefined ? "undefined" : safeType(payload),
    topLevelKeyCount: 0,
    knownKeys: [],
    hasOrganic: false,
    organicType: null,
    hasResult: false,
    resultType: null,
    resultHasOrganic: false,
    resultOrganicType: null,
    hasBody: false,
    bodyType: null,
    bodyJsonParsed: false,
    bodyJsonHasOrganic: false,
    hasPagination: false,
    hasGeneral: false,
    hasError: false,
    hasStatus: false
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return shape;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  shape.topLevelKeyCount = keys.length;
  shape.knownKeys = keys.filter((key) => SHAPE_KEY_ALLOWLIST.has(key));
  const has = (key: string): boolean => record[key] !== undefined;
  shape.hasOrganic = has("organic");
  shape.organicType = shape.hasOrganic ? safeType(record.organic) : null;
  shape.hasResult = has("result");
  shape.resultType = shape.hasResult ? safeType(record.result) : null;
  if (record.result && typeof record.result === "object" && !Array.isArray(record.result)) {
    const result = record.result as Record<string, unknown>;
    shape.resultHasOrganic = result.organic !== undefined;
    shape.resultOrganicType = shape.resultHasOrganic ? safeType(result.organic) : null;
  }
  shape.hasBody = has("body");
  shape.bodyType = shape.hasBody ? safeType(record.body) : null;
  if (typeof record.body === "string") {
    try {
      const parsed: unknown = JSON.parse(record.body);
      shape.bodyJsonParsed = true;
      shape.bodyJsonHasOrganic = Boolean(parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).organic !== undefined);
    } catch {
      shape.bodyJsonParsed = false;
    }
  }
  shape.hasPagination = has("pagination");
  shape.hasGeneral = has("general");
  shape.hasError = has("error");
  shape.hasStatus = has("status");
  return shape;
}

function mapRows(rows: unknown[]): BrightOrganicResult[] {
  const results: BrightOrganicResult[] = [];
  for (const row of rows.slice(0, PAGE_SIZE)) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const title = textField(record, ["title"]);
    if (!title) continue;
    const { rawUrl, displayedUrl } = getOrganicResultUrl(record);
    const evidence = EVIDENCE_FIELDS.flatMap((field) => evidenceStrings(record[field]));
    results.push({
      title,
      url: normalizeOrganicUrl(rawUrl),
      rawUrl,
      displayedUrl,
      snippet: textField(record, ["description", "snippet"]),
      evidence: [...new Set(evidence)]
    });
  }
  return results;
}

function requestedCountryCode(locations: readonly string[]): string | null {
  const requested = locations.at(-1)?.split(",").at(-1)?.trim();
  if (!requested) return null;
  const normalized = requested.toLocaleLowerCase("en").replace(/\./g, "");
  if (["us", "usa", "u s", "u s a", "united states"].includes(normalized)) return "us";
  if (["uk", "u k", "united kingdom"].includes(normalized)) return "gb";
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (display.of(code)?.toLocaleLowerCase("en") === normalized) return code.toLowerCase();
    }
  }
  return null;
}

export class BrightDataGoogleSearchProvider implements BrightDataPeopleSearchProvider {
  readonly configured: boolean;

  constructor(
    private readonly options: {
      apiKey?: string;
      zone?: string;
      fetcher?: typeof fetch;
      maxPages?: number;
      timeoutMs?: number;
      enabled?: boolean;
    } = {}
  ) {
    this.configured = Boolean(
      (options.enabled ?? env.DISCOVER_BRIGHTDATA_ENABLED) &&
      (options.apiKey ?? env.BRIGHTDATA_API_KEY)?.trim() &&
      (options.zone ?? env.BRIGHTDATA_SERP_ZONE)?.trim()
    );
  }

  async search(
    query: string,
    options: { page: number; requestedLocations: readonly string[]; signal?: AbortSignal }
  ): Promise<BrightDataPage> {
    if (!this.configured) {
      const error = new BrightDataSearchError("CONFIGURATION");
      logRequestFailed(error);
      throw error;
    }
    const maxPages = this.options.maxPages ?? env.DISCOVER_BRIGHTDATA_MAX_PAGES;
    if (!Number.isInteger(options.page) || options.page < 1 || options.page > maxPages) {
      return { results: [], rawOrganicResults: 0, page: options.page, exhausted: true };
    }
    const googleUrl = new URL("https://www.google.com/search");
    googleUrl.search = new URLSearchParams({
      q: query,
      hl: "en",
      gl: requestedCountryCode(options.requestedLocations) ?? "us",
      pws: "0",
      udm: "14",
      brd_json: "1",
      start: String((options.page - 1) * PAGE_SIZE)
    }).toString();
    try {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? env.DISCOVER_BRIGHTDATA_TIMEOUT_MS);
      const requestSignal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey ?? env.BRIGHTDATA_API_KEY}`
        },
        body: JSON.stringify({
          zone: this.options.zone ?? env.BRIGHTDATA_SERP_ZONE,
          url: googleUrl.toString(),
          format: "raw"
        }),
        signal: requestSignal
      };

      for (let attempt = 1; attempt <= MAX_BRIGHT_TRANSIENT_ATTEMPTS_PER_PAGE; attempt += 1) {
        requestSignal.throwIfAborted();
        const response = await (this.options.fetcher ?? fetch)("https://api.brightdata.com/request", requestInit);
        if (!response.ok) {
          throw new BrightDataSearchError(
            response.status === 401 || response.status === 403 ? "AUTHENTICATION" : "PROVIDER",
            { status: response.status, stage: "HTTP_ERROR" }
          );
        }

        const bodyText = await response.text();
        const classification = classifyBrightResponseBody(bodyText, response.headers.get("content-type"));
        if (classification !== "JSON") {
          if (attempt < MAX_BRIGHT_TRANSIENT_ATTEMPTS_PER_PAGE) {
            if (requestSignal.aborted) requestSignal.throwIfAborted();
            logRequestRetry({
              status: response.status,
              page: options.page,
              attempt,
              reason: transientBodyReason(classification)
            });
            continue;
          }
          throw new BrightDataSearchError("MALFORMED_RESPONSE", {
            status: response.status,
            stage: "JSON_PARSE"
          });
        }

        const payload: unknown = JSON.parse(bodyText);
        const rows = organicRows(payload);
        if (!rows) {
          console.info(JSON.stringify({
            event: "BRIGHT_RESPONSE_SHAPE",
            status: response.status,
            stage: "ORGANIC_ARRAY_MISSING",
            ...describeBrightResponseShape(payload)
          }));
          throw new BrightDataSearchError("MALFORMED_RESPONSE", { status: response.status, stage: "ORGANIC_ARRAY_MISSING" });
        }
        const results = mapRows(rows);
        return {
          results,
          rawOrganicResults: rows.length,
          page: options.page,
          exhausted: rows.length === 0 || options.page >= maxPages
        };
      }

      throw new BrightDataSearchError("MALFORMED_RESPONSE", { stage: "JSON_PARSE" });
    } catch (error) {
      if (error instanceof BrightDataSearchError) {
        logRequestFailed(error);
        throw error;
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        const timeoutError = new BrightDataSearchError("TIMEOUT", { stage: "TIMEOUT" });
        logRequestFailed(timeoutError);
        throw timeoutError;
      }
      const networkError = new BrightDataSearchError("PROVIDER", { stage: "NETWORK" });
      logRequestFailed(networkError);
      throw networkError;
    }
  }
}
