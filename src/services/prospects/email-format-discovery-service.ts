import { lookup } from "node:dns/promises";
import net from "node:net";

import { type ConfidenceLevel, type EmailPattern, isEmailPattern } from "@/lib/prospect-enums";
import {
  type EmailDomainEvidence,
  type EmailEvidenceBundle,
  type EmailEvidenceProvider,
  type EmailEvidenceProviderInput,
  type EmailPatternEvidence,
  buildEmailFormatSearchQueries,
  isAllowedBusinessEmailDomain
} from "@/services/prospects/email-domain-service";
import { normalizeDomain } from "@/services/prospects/prospect-normalization";

const MAX_PUBLIC_PAGE_BYTES = 2 * 1024 * 1024;
const PUBLIC_PAGE_TIMEOUT_MS = 9_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Sendloom Prospect Email Format Discovery/1.0 (+https://sendloom.local)";

import { createConfiguredWebSearchProvider, type WebSearchProvider, type WebSearchResult as SearchResult } from "./web-search-provider";
export type EmailFormatSearchProvider = WebSearchProvider;

export type PublicPageFetcher = (url: string) => Promise<string>;

type ParsedFormatRow = {
  sourceName: string;
  sourceUrl: string | null;
  patternRaw: string;
  pattern: EmailPattern;
  example: string;
  emailDomain: string;
  percentage: number | null;
  confidence: ConfidenceLevel;
};

const RAW_PATTERN_MAP: Record<string, EmailPattern> = {
  "[first_initial][last]": "flast",
  "[first_initial].[last]": "f.last",
  "[first_initial]_[last]": "f_last",
  "[first].[last]": "first.last",
  "[first]_[last]": "first_last",
  "[first][last]": "firstlast",
  "[first].[last_initial]": "first.l",
  "[first][last_initial]": "firstl",
  "[last]": "last",
  "[first]": "first",
  "[last][first_initial]": "lastf"
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function canonicalPattern(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, "")
    .replace(/firstinitial/g, "first_initial")
    .replace(/lastinitial/g, "last_initial")
    .replace(/\[first\.initial\]/g, "[first_initial]")
    .replace(/\[last\.initial\]/g, "[last_initial]");
}

export function normalizePublicEmailPattern(raw: string): EmailPattern | null {
  const canonical = canonicalPattern(raw);
  if (RAW_PATTERN_MAP[canonical]) {
    return RAW_PATTERN_MAP[canonical];
  }
  if (isEmailPattern(canonical)) {
    return canonical;
  }
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToVisibleText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceNameForUrl(url: string | null): string {
  if (!url) {
    return "Public email-format source";
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("rocketreach.co")) {
      return "RocketReach";
    }
    if (host.includes("hunter.io")) {
      return "Hunter";
    }
    return host;
  } catch {
    return "Public email-format source";
  }
}

function percentageFrom(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidenceForParsedRow(percentage: number | null, surroundingText: string): ConfidenceLevel {
  if (percentage !== null && percentage >= 75) {
    return "HIGH";
  }
  if (/\b(most common|highest percentage|most used|primary)\b/i.test(surroundingText)) {
    return "HIGH";
  }
  if (percentage !== null && percentage >= 35) {
    return "MEDIUM";
  }
  return "LOW";
}

function makeRowsFromMatches(text: string, sourceUrl: string | null): ParsedFormatRow[] {
  const sourceName = sourceNameForUrl(sourceUrl);
  const rows: ParsedFormatRow[] = [];
  const seen = new Set<string>();
  const rawPattern = String.raw`\[[^\]]+\](?:\s*[._-]?\s*\[[^\]]+\])*`;
  const email = String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`;
  const patterns = [
    new RegExp(
      String.raw`(?:most common|highest percentage|most used|primary)[\s\S]{0,180}?(${rawPattern})[\s\S]{0,140}?(?:ex\.?|example)?\s*[:(]?\s*(${email})[\s\S]{0,140}?(\d+(?:\.\d+)?)\s*%`,
      "gi"
    ),
    new RegExp(String.raw`(${rawPattern})\s*(?:\||,|\s{2,})\s*(${email})\s*(?:\||,|\s{2,})?\s*(\d+(?:\.\d+)?)?\s*%?`, "gi"),
    new RegExp(String.raw`(${rawPattern})[\s\S]{0,80}?(${email})`, "gi")
  ];

  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      const patternRaw = match[1]?.trim();
      const example = match[2]?.trim().toLowerCase();
      if (!patternRaw || !example) {
        continue;
      }
      const pattern = normalizePublicEmailPattern(patternRaw);
      const emailDomain = normalizeDomain(example);
      if (!pattern || !emailDomain || !isAllowedBusinessEmailDomain(emailDomain)) {
        continue;
      }
      const percentage = percentageFrom(match[3]);
      const index = typeof match.index === "number" ? match.index : 0;
      const surrounding = text.slice(Math.max(0, index - 120), index + match[0].length + 120);
      const key = `${pattern}|${example}|${percentage ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        sourceName,
        sourceUrl,
        patternRaw,
        pattern,
        example,
        emailDomain,
        percentage,
        confidence: confidenceForParsedRow(percentage, surrounding)
      });
    }
  }

  return rows;
}

// Role / functional mailboxes that carry no personal name structure — never a
// basis for inferring a first/last email pattern.
const ROLE_LOCAL_PARTS = new Set([
  "info",
  "sales",
  "support",
  "help",
  "contact",
  "admin",
  "hr",
  "careers",
  "jobs",
  "press",
  "media",
  "team",
  "hello",
  "hi",
  "office",
  "billing",
  "accounts",
  "legal",
  "privacy",
  "security",
  "marketing",
  "noreply",
  "no-reply",
  "donotreply",
  "webmaster",
  "postmaster",
  "abuse"
]);

// Extract candidate work-email addresses from RAW page input (before tag
// stripping) so `mailto:` hrefs are captured alongside visible-text examples.
export function extractCandidateEmails(rawInput: string): string[] {
  const decoded = decodeHtmlEntities(rawInput);
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const seen = new Set<string>();
  for (const match of decoded.matchAll(emailRe)) {
    const email = match[0].trim().toLowerCase().replace(/^mailto:/, "");
    seen.add(email);
  }
  return [...seen];
}

// Structural pattern of ONE example local part, using an explicit separator only
// (`.` or `_`). Separatorless forms (jsmith vs johnsmith) are intentionally not
// inferred — they are ambiguous without the person's real name.
function structuralPatternForLocalPart(localPart: string): EmailPattern | null {
  const match = localPart.match(/^([a-z]+)([._])([a-z]+)$/);
  if (!match) {
    return null;
  }
  const [, first, separator, last] = match;
  if (separator === ".") {
    if (first.length >= 2 && last.length >= 2) {
      return "first.last";
    }
    if (first.length === 1 && last.length >= 2) {
      return "f.last";
    }
    if (first.length >= 2 && last.length === 1) {
      return "first.l";
    }
    return null;
  }
  // separator === "_"
  if (first.length >= 2 && last.length >= 2) {
    return "first_last";
  }
  if (first.length === 1 && last.length >= 2) {
    return "f_last";
  }
  return null;
}

/**
 * Infer a company email domain + supported pattern from two or more consistent
 * PUBLIC work-email examples (e.g. a contact/team page with
 * `jane.doe@acme.com` and `john.smith@acme.com`), when no explicit
 * bracket-style format table is present. Deterministic, no AI:
 *
 *  - only business domains are considered (personal mailboxes are rejected);
 *  - only separator-based structures are inferred (never ambiguous `flast`);
 *  - role mailboxes (info@, careers@, …) are excluded;
 *  - at least two DISTINCT local parts must agree on the same domain + pattern;
 *  - confidence is MEDIUM (raised to HIGH with three or more agreeing examples).
 */
export function inferPatternFromExampleEmails(
  emails: string[],
  options: { sourceUrl?: string | null } = {}
): ParsedFormatRow | null {
  const byDomain = new Map<string, Map<EmailPattern, Set<string>>>();
  for (const email of emails) {
    const at = email.indexOf("@");
    if (at <= 0) {
      continue;
    }
    const localPart = email.slice(0, at);
    if (ROLE_LOCAL_PARTS.has(localPart)) {
      continue;
    }
    const domain = normalizeDomain(email.slice(at + 1));
    if (!domain || !isAllowedBusinessEmailDomain(domain)) {
      continue;
    }
    const pattern = structuralPatternForLocalPart(localPart);
    if (!pattern) {
      continue;
    }
    if (!byDomain.has(domain)) {
      byDomain.set(domain, new Map());
    }
    const patterns = byDomain.get(domain)!;
    if (!patterns.has(pattern)) {
      patterns.set(pattern, new Set());
    }
    patterns.get(pattern)!.add(localPart);
  }

  let best: { domain: string; pattern: EmailPattern; count: number } | null = null;
  for (const [domain, patterns] of byDomain) {
    for (const [pattern, localParts] of patterns) {
      const count = localParts.size;
      if (count >= 2 && (!best || count > best.count)) {
        best = { domain, pattern, count };
      }
    }
  }
  if (!best) {
    return null;
  }

  return {
    sourceName: sourceNameForUrl(options.sourceUrl ?? null),
    sourceUrl: options.sourceUrl ?? null,
    patternRaw: best.pattern,
    pattern: best.pattern,
    example: `${best.pattern}@${best.domain}`,
    emailDomain: best.domain,
    percentage: null,
    confidence: best.count >= 3 ? "HIGH" : "MEDIUM"
  };
}

export function parsePublicEmailFormatEvidence(
  input: string,
  options: { sourceUrl?: string | null } = {}
): EmailEvidenceBundle & { rows: ParsedFormatRow[] } {
  const text = htmlToVisibleText(input);
  let rows = makeRowsFromMatches(text, options.sourceUrl ?? null);
  // Fallback: when a page has no explicit bracket-style format table, infer the
  // format from consistent public work-email examples (visible text + mailto:).
  if (rows.length === 0) {
    const inferred = inferPatternFromExampleEmails(extractCandidateEmails(input), {
      sourceUrl: options.sourceUrl ?? null
    });
    if (inferred) {
      rows = [inferred];
    }
  }
  const observedAtIso = new Date().toISOString();

  const domainEvidence: EmailDomainEvidence[] = rows.map((row) => ({
    emailDomain: row.emailDomain,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourceType: "public_format_page",
    observedPattern: row.pattern,
    percentage: row.percentage,
    confidence: row.confidence,
    observedAt: observedAtIso
  }));

  const patternEvidence: EmailPatternEvidence[] = rows.map((row) => ({
    pattern: row.pattern,
    emailDomain: row.emailDomain,
    percentage: row.percentage,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourceType: "public_format_page",
    confidence: row.confidence,
    observedAt: observedAtIso
  }));

  return { domainEvidence, patternEvidence, rows };
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:") || value === "::";
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https evidence URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Evidence URLs must not include credentials.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost evidence URLs are blocked.");
  }
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error("Private evidence URLs are blocked.");
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address.address))) {
    throw new Error("Private evidence URLs are blocked.");
  }
}

export async function safeFetchPublicText(url: string, redirects = 0): Promise<string> {
  const parsed = new URL(url);
  await assertPublicUrl(parsed);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      credentials: "omit",
      headers: {
        accept: "text/html,text/plain,application/xhtml+xml",
        "user-agent": USER_AGENT
      }
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) {
        throw new Error("Evidence URL redirected too many times.");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Evidence URL redirect did not include a location.");
      }
      return safeFetchPublicText(new URL(location, parsed).toString(), redirects + 1);
    }

    if (!response.ok) {
      throw new Error(`Evidence URL returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Evidence URL did not return text or HTML.");
    }
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_PUBLIC_PAGE_BYTES) {
      throw new Error("Evidence URL response was too large.");
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_PUBLIC_PAGE_BYTES) {
      throw new Error("Evidence URL response was too large.");
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

function candidateUrls(results: SearchResult[]): string[] {
  const scored = results
    .filter((result) => /^https?:\/\//i.test(result.url))
    .map((result) => {
      const haystack = `${result.url} ${result.title} ${result.snippet ?? ""}`.toLowerCase();
      let score = 0;
      if (haystack.includes("rocketreach.co")) {
        score += 50;
      }
      if (haystack.includes("hunter.io")) {
        score += 35;
      }
      if (haystack.includes("email-format") || haystack.includes("email format")) {
        score += 25;
      }
      return { url: result.url, score };
    })
    .sort((a, b) => b.score - a.score);
  return unique(scored.map((item) => item.url)).slice(0, 5);
}

function snippetEvidence(result: SearchResult): EmailEvidenceBundle {
  if (!result.snippet) {
    return {};
  }
  return parsePublicEmailFormatEvidence(result.snippet, { sourceUrl: result.url });
}

export function createConfiguredEmailFormatSearchProvider(): EmailFormatSearchProvider | null {
  const provider = createConfiguredWebSearchProvider();
  // One Google navigation is reserved for people discovery. Email format work
  // continues through cached/AI/source evidence, never another Google SERP.
  return provider?.peopleQueryStrategy === "single_role_union" ? null : provider;
}

export class EmailFormatDiscoveryService implements EmailEvidenceProvider {
  constructor(
    private readonly options: {
      searchProvider?: EmailFormatSearchProvider | null;
      fetchPage?: PublicPageFetcher;
      /**
       * When false, stay silent if no legacy search provider is configured. Used
       * when this service is only the source-URL fallback behind AI web search,
       * so the "No web search provider configured" line is not logged on every
       * automatic discovery.
       */
      warnWhenUnconfigured?: boolean;
    } = {}
  ) {}

  async findEvidence(input: EmailEvidenceProviderInput): Promise<EmailEvidenceBundle> {
    const bundles: EmailEvidenceBundle[] = [];
    const fetchPage = this.options.fetchPage ?? safeFetchPublicText;
    let providerFailed = false;

    if (input.sourceUrl) {
      try {
        const text = await fetchPage(input.sourceUrl);
        bundles.push(parsePublicEmailFormatEvidence(text, { sourceUrl: input.sourceUrl }));
      } catch (error) {
        return {
          discoveryStatus: error instanceof TypeError ? "NETWORK_ERROR" : "BAD_PROVIDER_RESPONSE",
          discoveryReason: "The public email-format source could not be retrieved safely."
        };
      }
    }

    const provider = this.options.searchProvider ?? createConfiguredEmailFormatSearchProvider();
    if (!provider?.configured) {
      if (!input.sourceUrl && this.options.warnWhenUnconfigured !== false) {
        console.warn("[prospect-email-discovery] No web search provider configured");
      }
      const merged = mergeBundles(bundles);
      const found = Boolean((merged.domainEvidence?.length ?? 0) && (merged.patternEvidence?.length ?? 0));
      return {
        ...merged,
        discoveryStatus: found ? "FOUND" : input.sourceUrl ? "NO_EVIDENCE" : "NOT_CONFIGURED",
        discoveryReason: found
          ? null
          : input.sourceUrl
            ? "No public email-format evidence was found at the supplied source."
            : "No deterministic public-search provider is configured."
      };
    }

    const queries = buildEmailFormatSearchQueries(input.companyName, normalizeDomain(input.officialWebsiteDomain));
    for (const query of queries) {
      let results: SearchResult[] = [];
      try {
        results = await provider.search(query);
      } catch (error) {
        console.warn("[prospect-email-discovery] search failed", error instanceof Error ? error.message : error);
        providerFailed = true;
        continue;
      }
      bundles.push(...results.map(snippetEvidence));
      for (const url of candidateUrls(results)) {
        try {
          const text = await fetchPage(url);
          bundles.push(parsePublicEmailFormatEvidence(text, { sourceUrl: url }));
        } catch (error) {
          console.warn("[prospect-email-discovery] source fetch failed", sanitizeUrlForLog(url), error instanceof Error ? error.message : error);
          providerFailed = true;
        }
      }
    }

    const merged = mergeBundles(bundles);
    const found = Boolean((merged.domainEvidence?.length ?? 0) && (merged.patternEvidence?.length ?? 0));
    return {
      ...merged,
      discoveryStatus: found ? "FOUND" : providerFailed ? "NETWORK_ERROR" : "NO_EVIDENCE",
      discoveryReason: found
        ? null
        : providerFailed
          ? "One or more public evidence sources could not be reached."
          : "No public email-format evidence was found."
    };
  }
}

function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function mergeBundles(bundles: EmailEvidenceBundle[]): EmailEvidenceBundle {
  return {
    domainEvidence: bundles.flatMap((bundle) => bundle.domainEvidence ?? []),
    patternEvidence: bundles.flatMap((bundle) => bundle.patternEvidence ?? [])
  };
}
