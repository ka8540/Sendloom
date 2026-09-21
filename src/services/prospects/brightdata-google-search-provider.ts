import { env } from "@/lib/env";
import { inspectGoogleResultRedirect } from "@/services/prospects/linkedin-profile-url";

export type BrightDataFailure = "CONFIGURATION" | "AUTHENTICATION" | "TIMEOUT" | "PROVIDER" | "MALFORMED_RESPONSE";

export class BrightDataSearchError extends Error {
  constructor(readonly kind: BrightDataFailure) {
    super("Bright Data public search failed.");
    this.name = "BrightDataSearchError";
  }
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
const TIMEOUT_MS = 30_000;

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
    if (!this.configured) throw new BrightDataSearchError("CONFIGURATION");
    const maxPages = this.options.maxPages ?? env.DISCOVER_BRIGHTDATA_MAX_PAGES;
    if (!Number.isInteger(options.page) || options.page < 1 || options.page > maxPages) {
      return { results: [], page: options.page, exhausted: true };
    }
    const googleUrl = new URL("https://www.google.com/search");
    googleUrl.search = new URLSearchParams({
      q: query,
      hl: "en",
      gl: requestedCountryCode(options.requestedLocations) ?? "us",
      pws: "0",
      udm: "14",
      brd_json: "json",
      start: String((options.page - 1) * PAGE_SIZE)
    }).toString();
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const response = await (this.options.fetcher ?? fetch)("https://api.brightdata.com/request", {
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
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
      });
      if (!response.ok) {
        throw new BrightDataSearchError(response.status === 401 || response.status === 403 ? "AUTHENTICATION" : "PROVIDER");
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new BrightDataSearchError("MALFORMED_RESPONSE");
      }
      const rows = organicRows(payload);
      if (!rows) throw new BrightDataSearchError("MALFORMED_RESPONSE");
      const results = mapRows(rows);
      return { results, page: options.page, exhausted: rows.length < PAGE_SIZE };
    } catch (error) {
      if (error instanceof BrightDataSearchError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") throw new BrightDataSearchError("TIMEOUT");
      throw new BrightDataSearchError("PROVIDER");
    }
  }
}
