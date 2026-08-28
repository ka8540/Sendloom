import { env } from "@/lib/env";
import {
  normalizeCompanyName,
  normalizeTitle,
  parseLocation,
  stripDiacritics
} from "@/services/prospects/prospect-normalization";
import {
  type PersonIdentityStatus,
  parsePersonName
} from "@/services/prospects/prospect-person-name";

// Minimal normalized profile. We deliberately discard everything Sendloom does
// not need (photos, phone numbers, personal emails, education, full employment
// history, biographies, posts, connections) right at the ingestion boundary.
//
// Name components are ALREADY canonical here: this is the single place raw
// provider name fields are parsed, so nothing downstream (shared cache, user
// materialization, email generation) ever sees a display name carrying
// credentials, emoji, honorifics, or a parenthetical alias.
export type NormalizedProfile = {
  sourceProfileId: string;
  /** Canonical given name. Empty when only an initial is known. */
  firstName: string;
  /** Canonical family name. Empty when unknown or only an initial. */
  lastName: string;
  /** Clean display name; keeps an alias and an unresolved surname initial. */
  fullName: string;
  /** Parenthetical alternate given names, for human context only. */
  alternateFirstNames: string[];
  /** How complete the identity is; drives whether an email may be generated. */
  identityStatus: PersonIdentityStatus;
  currentTitle: string | null;
  normalizedTitle: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedinUrl: string;
  currentCompanyName: string | null;
  currentCompanyUrl: string | null;
  /** Provider headline, retained only for narrowly-labelled employer evidence. */
  headline?: string | null;
};

export type ApifyProfileSearchStage = "EXACT" | "FALLBACK_ALIAS";

export type ApifyProfileSearchInput = {
  companyName: string;
  companyLinkedinUrl?: string | null;
  jobTitles: string[];
  locations: string[];
  maxResults: number;
  stage?: ApifyProfileSearchStage;
};

export type ApifyProfileSearchResult = {
  profiles: NormalizedProfile[];
  runId: string | null;
  datasetId: string | null;
  totalFound: number;
  /** Per-stage safe ingestion counts/codes for diagnostics and logging. */
  diagnostics: ApifyIngestionDiagnostics;
};

// The exact provider boundary for dami_studio/linkedin-profile-search-scraper.
// Keep structured role/location intent as arrays; the actor does not expose an
// offset/page input, so continuation is implemented by requesting deeper
// bounded prefixes in DiscoverExpansionService.
export type ApifyActorInput = {
  currentCompanies?: string[];
  currentJobTitles?: string[];
  locations?: string[];
  maxItems: number;
};

/**
 * Map a resolved prospect search into the public-index profile-search actor.
 * Dami's profile-search actor produces materially better results from the
 * canonical company NAME. A LinkedIn URL is retained only as a defensive
 * fallback for callers that have no resolved name at all.
 */
export function buildActorInput(input: ApifyProfileSearchInput): ApifyActorInput {
  const maxItems = Math.min(120, Math.max(1, Math.floor(input.maxResults)));
  const companyName = input.companyName.trim();
  const companyFilter = companyName || input.companyLinkedinUrl?.trim() || "";
  return {
    currentCompanies: companyFilter ? [companyFilter] : undefined,
    currentJobTitles: input.jobTitles,
    locations: input.locations,
    maxItems
  };
}

export type RawProfile = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

/**
 * Extract only a clearly labelled Location field from Dami's public-index
 * snippet. Arbitrary geography elsewhere in the page text is deliberately
 * ignored because it may describe another result, employer, or reference.
 */
export function extractLabelledSnippetLocation(value: unknown): string | null {
  const snippet = asString(value);
  if (!snippet) return null;

  const labelled = /(?:^|[\n\r\u00b7\u2022|])\s*location\s*:\s*([^\n\r\u00b7\u2022|]{1,160})/i.exec(snippet);
  if (!labelled) return null;

  const location = labelled[1]
    .replace(/\s+\d[\d,.]*\+?\s+connections?\b.*$/i, "")
    .replace(/\s+(?:experience|education|about|headline|current company)\s*:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,-]+$/, "")
    .trim();

  if (!location || location.length > 120 || /https?:\/\//i.test(location)) {
    return null;
  }
  return location;
}

function readLocation(raw: RawProfile): string | null {
  const direct = asString(raw.location);
  if (direct) {
    return direct;
  }
  const loc = raw.location;
  if (loc && typeof loc === "object") {
    const obj = loc as Record<string, unknown>;
    const structured = asString(obj.linkedinText) ?? asString(obj.text) ?? asString(obj.parsed);
    if (structured) return structured;
  }
  return asString(raw.locationName)
    ?? asString(raw.geoRegion)
    ?? extractLabelledSnippetLocation(raw.snippet);
}

function readCurrentPosition(raw: RawProfile): { title: string | null; companyName: string | null; companyUrl: string | null } {
  const positions = Array.isArray(raw.currentPosition)
    ? (raw.currentPosition as RawProfile[])
    : Array.isArray(raw.positions)
      ? (raw.positions as RawProfile[])
      : Array.isArray(raw.experience)
        ? (raw.experience as RawProfile[])
        : [];

  const current = positions[0] ?? {};
  return {
    title: asString(current.title) ?? asString(current.position) ?? null,
    companyName: asString(current.companyName) ?? asString(current.company) ?? null,
    companyUrl: asString(current.companyLinkedinUrl) ?? asString(current.companyUrl) ?? null
  };
}

function isLinkedinProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) &&
      /^\/in\/[^/?#]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function readProfileUrl(raw: RawProfile): string | null {
  return asString(raw.linkedinUrl) ?? asString(raw.profileUrl) ?? asString(raw.url);
}

/**
 * Normalize one raw actor item into a NormalizedProfile, or null if it lacks
 * the minimum professional identity we require (a name and a profile URL).
 *
 * The name is resolved by the one canonical identity parser rather than a
 * whitespace split. The old split treated every token after the first as the
 * family name, which is what turned "Jared Cho M.B.A." into the surname
 * "Cho M.B.A." (and the address jared.chomba@apple.com).
 */
export function normalizeProfile(raw: RawProfile): NormalizedProfile | null {
  const linkedinUrl = readProfileUrl(raw);
  if (!linkedinUrl || !isLinkedinProfileUrl(linkedinUrl)) {
    return null;
  }

  const identity = parsePersonName({
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    fullName: asString(raw.fullName) ?? asString(raw.name)
  });

  // No usable given name at all — the item carries no professional identity.
  if (identity.status === "UNUSABLE") {
    return null;
  }

  const sourceProfileId =
    asString(raw.id) ??
    asString(raw.publicIdentifier) ??
    asString(raw.profileId) ??
    linkedinUrl.replace(/\/+$/, "").split("/").pop() ??
    linkedinUrl;

  const structuredPosition = readCurrentPosition(raw);
  const headline = asString(raw.headline);
  const currentTitle = asString(raw.currentPosition) ?? structuredPosition.title ?? headline;
  const parsedLocation = parseLocation(readLocation(raw));

  return {
    sourceProfileId,
    firstName: identity.firstName ?? "",
    lastName: identity.lastName ?? "",
    fullName: identity.fullName,
    alternateFirstNames: identity.alternateFirstNames,
    identityStatus: identity.status,
    currentTitle,
    normalizedTitle: currentTitle ? normalizeTitle(currentTitle) : null,
    location: parsedLocation.location,
    city: parsedLocation.city,
    state: parsedLocation.state,
    country: parsedLocation.country,
    linkedinUrl,
    currentCompanyName:
      asString(raw.currentCompany) ?? structuredPosition.companyName ?? asString(raw.companyName),
    currentCompanyUrl: structuredPosition.companyUrl ?? asString(raw.companyLinkedinUrl),
    headline
  };
}

function companyUrlSlug(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// LinkedIn serves the same company page under punctuation-variant vanity slugs
// (e.g. "jpmorgan-chase" and "jpmorganchase"), so slugs are compared on their
// alphanumeric identity, never raw string equality.
function normalizedCompanySlug(url: string | null | undefined): string | null {
  const slug = companyUrlSlug(url);
  if (!slug) {
    return null;
  }
  const normalized = slug.replace(/[^a-z0-9]/g, "");
  return normalized || null;
}

// Tokens that carry no employer identity when comparing name aliases
// ("JPMorgan Chase & Co." normalizes with a lone "and" from the ampersand).
const COMPANY_ALIAS_STOPWORDS = new Set(["and", "the"]);
// A squashed-name prefix shorter than this can never claim an alias match
// ("GE" must not swallow every company starting with those letters).
const MIN_ALIAS_PREFIX_LENGTH = 4;

// Insert spaces at camelCase transitions so "JPMorganChase" tokenizes like
// "JPMorgan Chase" before normalization.
function expandCamelCase(name: string): string {
  return stripDiacritics(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

type CompanyAliasKey = {
  squashed: string;
  /** Cumulative token-end offsets within `squashed` (word boundaries). */
  boundaries: Set<number>;
};

function companyAliasKey(name: string): CompanyAliasKey {
  const tokens = normalizeCompanyName(expandCamelCase(name))
    .split(" ")
    .filter((token) => token && !COMPANY_ALIAS_STOPWORDS.has(token));
  const squashed = tokens.join("");
  const boundaries = new Set<number>();
  let length = 0;
  for (const token of tokens) {
    length += token.length;
    boundaries.add(length);
  }
  return { squashed, boundaries };
}

function companyNameVariants(name: string): string[] {
  const parentheticalAliases = [...name.matchAll(/\(([^()]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const withoutParentheticals = name.replace(/\([^()]+\)/g, " ").replace(/\s+/g, " ").trim();
  return [name, withoutParentheticals, ...parentheticalAliases].filter(Boolean);
}

function compactCompanyInitialismCandidate(name: string): string | null {
  const compact = stripDiacritics(name).replace(/[^A-Za-z0-9]/g, "");
  return /^[A-Z0-9]{2,6}$/.test(compact) ? compact.toLowerCase() : null;
}

function companyInitialisms(name: string): ReadonlySet<string> {
  const withoutParentheticals = expandCamelCase(name).replace(/\([^()]+\)/g, " ");
  const tokens = withoutParentheticals
    .match(/[A-Za-z0-9]+/g)
    ?.filter((token) => !COMPANY_ALIAS_STOPWORDS.has(token.toLowerCase())) ?? [];
  if (tokens.length < 2) return new Set();

  const allTokens = tokens.map((token) => token[0]?.toLowerCase()).join("");
  return allTokens.length >= 2 && allTokens.length <= 6 ? new Set([allTokens]) : new Set();
}

function companyInitialismMatches(shortName: string, longName: string): boolean {
  const candidate = compactCompanyInitialismCandidate(shortName);
  return Boolean(candidate && companyInitialisms(longName).has(candidate));
}

/**
 * Alias-tolerant employer-name comparison. Accepts the same employer written
 * with different punctuation, corporate suffixes, spacing, or a shortened form
 * that stops at a word boundary ("JPMorgan" for "JPMorgan Chase & Co."), while
 * still rejecting lookalike prefixes of an unrelated single-word name
 * ("Apple" never matches "Applebee's").
 */
export function companyNamesAliasMatch(a: string, b: string): boolean {
  const variantsA = companyNameVariants(a);
  const variantsB = companyNameVariants(b);

  for (const variantA of variantsA) {
    for (const variantB of variantsB) {
      const keyA = companyAliasKey(variantA);
      const keyB = companyAliasKey(variantB);
      if (!keyA.squashed || !keyB.squashed) continue;
      if (keyA.squashed === keyB.squashed) return true;

      const [short, long] = keyA.squashed.length <= keyB.squashed.length ? [keyA, keyB] : [keyB, keyA];
      if (
        short.squashed.length >= MIN_ALIAS_PREFIX_LENGTH
        && long.squashed.startsWith(short.squashed)
        && long.boundaries.has(short.squashed.length)
      ) {
        return true;
      }
      if (
        companyInitialismMatches(variantA, variantB)
        || companyInitialismMatches(variantB, variantA)
      ) {
        return true;
      }
    }
  }
  return false;
}

type CompanyMatchTarget = {
  companyName: string;
  linkedinCompanyUrl?: string | null;
  /** True only when this dataset came from an exact canonical-company query. */
  providerConstrained?: boolean;
};

export type CurrentCompanyMatchReason =
  | "CONFIRMED"
  | "PROVIDER_CONSTRAINED_UNKNOWN"
  | "EXPLICIT_CONTRADICTION";

export type CurrentCompanyMatch = {
  matches: boolean;
  reason: CurrentCompanyMatchReason;
};

function headlineCompanyEvidence(headline: string | null | undefined): string | null {
  if (!headline) return null;
  const match = /(?:^|\s)(?:@\s*|at\s+)([^|\u00b7\u2022;,]{2,100}?)(?=\s*(?:[|\u00b7\u2022;,]|$))/i.exec(
    headline.trim()
  );
  return match?.[1]?.trim() || null;
}

/**
 * Decide whether a profile's current employer matches the resolved company.
 * Explicit matching evidence is confirmed and explicit conflicting evidence
 * is rejected. Missing evidence may survive only when the caller certifies
 * that this dataset came from an exact canonical-company provider request.
 *
 * An explicit employer NAME is authoritative and compared alias-tolerantly.
 * When the name is absent, a LinkedIn company-URL identity match is also
 * positive evidence. Slugs are compared on normalized alphanumeric identity
 * because LinkedIn aliases punctuation-variant vanity slugs.
 */
export function evaluateCurrentCompanyMatch(
  profile: NormalizedProfile,
  target: CompanyMatchTarget
): CurrentCompanyMatch {
  const targetSlug = normalizedCompanySlug(target.linkedinCompanyUrl);
  const profileSlug = normalizedCompanySlug(profile.currentCompanyUrl);
  if (profile.currentCompanyName && target.companyName) {
    if (companyNamesAliasMatch(profile.currentCompanyName, target.companyName)) {
      return { matches: true, reason: "CONFIRMED" };
    }
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  if (targetSlug && profileSlug && targetSlug === profileSlug) {
    return { matches: true, reason: "CONFIRMED" };
  }

  if (targetSlug && profileSlug && targetSlug !== profileSlug) {
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  const headlineCompany = headlineCompanyEvidence(profile.headline);
  if (headlineCompany) {
    return companyNamesAliasMatch(headlineCompany, target.companyName)
      ? { matches: true, reason: "CONFIRMED" }
      : { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  return target.providerConstrained
    ? { matches: true, reason: "PROVIDER_CONSTRAINED_UNKNOWN" }
    : { matches: false, reason: "EXPLICIT_CONTRADICTION" };
}

export function currentCompanyMatches(
  profile: NormalizedProfile,
  target: CompanyMatchTarget
): boolean {
  return evaluateCurrentCompanyMatch(profile, target).matches;
}

/** Remove duplicate profiles, preferring the first occurrence. */
export function dedupeProfiles(profiles: NormalizedProfile[]): NormalizedProfile[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const result: NormalizedProfile[] = [];
  for (const profile of profiles) {
    const id = profile.sourceProfileId?.trim().toLowerCase() ?? "";
    const url = profile.linkedinUrl?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
    if ((id && seenIds.has(id)) || (url && seenUrls.has(url))) {
      continue;
    }
    if (id) seenIds.add(id);
    if (url) seenUrls.add(url);
    result.push(profile);
  }
  return result;
}

/**
 * Privacy-safe, per-stage ingestion diagnostics for one dataset. Diagnostic
 * codes are normalized to a short allowlisted character set; names, messages,
 * URLs, and raw items never leave the provider boundary.
 */
export type ApifyIngestionDiagnostics = {
  itemsReturned: number;
  profileRows: number;
  diagnosticItems: number;
  diagnosticCodes: string[];
  temporaryDiagnosticItems: number;
  parsedCandidates: number;
  rejectedBySchema: number;
  duplicateItems: number;
  companyMatched: number;
  rejectedByCompany: number;
  companyConfirmed: number;
  companyProviderConstrainedUnknown: number;
  companyRejected: number;
};

export type ProcessedDatasetItems = {
  profiles: NormalizedProfile[];
  diagnostics: ApifyIngestionDiagnostics;
};

const NO_RESULTS_DIAGNOSTIC_CODE = "NO_RESULTS";

function safeDiagnosticCode(value: unknown): string {
  const code = asString(value)?.toUpperCase();
  return code && /^[A-Z0-9_-]{1,64}$/.test(code) ? code : "UNKNOWN";
}

function isExplicitDiagnostic(item: RawProfile): boolean {
  return asString(item.recordType)?.toLowerCase() === "diagnostic" || item.ok === false;
}

function isProfileRow(item: RawProfile): boolean {
  if (isExplicitDiagnostic(item)) {
    return false;
  }
  if (asString(item.recordType)?.toLowerCase() === "profile") {
    return true;
  }
  const profileUrl = readProfileUrl(item);
  return profileUrl ? isLinkedinProfileUrl(profileUrl) : false;
}

/**
 * Normalize, dedupe, and company-filter raw dataset items. One malformed item
 * only increments a rejection counter — it never fails the batch. Shared by the
 * live search path and stored-dataset reprocessing so both apply identical
 * eligibility rules.
 */
export function processDatasetItems(
  items: RawProfile[],
  target: CompanyMatchTarget,
  maxResults: number
): ProcessedDatasetItems {
  const profileItems: RawProfile[] = [];
  const diagnosticCodes: string[] = [];
  let diagnosticItems = 0;
  let temporaryDiagnosticItems = 0;
  let rejectedBySchema = 0;

  for (const item of items) {
    if (isExplicitDiagnostic(item)) {
      diagnosticItems += 1;
      const code = safeDiagnosticCode(item.code);
      if (!diagnosticCodes.includes(code)) {
        diagnosticCodes.push(code);
      }
      if (code !== NO_RESULTS_DIAGNOSTIC_CODE) {
        temporaryDiagnosticItems += 1;
      }
    } else if (isProfileRow(item)) {
      profileItems.push(item);
    } else {
      rejectedBySchema += 1;
    }
  }

  const normalized: NormalizedProfile[] = [];
  for (const item of profileItems) {
    let profile: NormalizedProfile | null = null;
    try {
      profile = normalizeProfile(item);
    } catch {
      profile = null;
    }
    if (profile) {
      normalized.push(profile);
    } else {
      rejectedBySchema += 1;
    }
  }

  const deduped = dedupeProfiles(normalized);
  const companyEvaluations = deduped.map((profile) => ({
    profile,
    evaluation: evaluateCurrentCompanyMatch(profile, target)
  }));
  const matched = companyEvaluations
    .filter(({ evaluation }) => evaluation.matches)
    .map(({ profile }) => profile);
  const companyConfirmed = companyEvaluations.filter(
    ({ evaluation }) => evaluation.reason === "CONFIRMED"
  ).length;
  const companyProviderConstrainedUnknown = companyEvaluations.filter(
    ({ evaluation }) => evaluation.reason === "PROVIDER_CONSTRAINED_UNKNOWN"
  ).length;
  const companyRejected = companyEvaluations.length - matched.length;

  return {
    profiles: matched.slice(0, Math.max(1, Math.floor(maxResults))),
    diagnostics: {
      itemsReturned: items.length,
      profileRows: profileItems.length,
      diagnosticItems,
      diagnosticCodes,
      temporaryDiagnosticItems,
      parsedCandidates: normalized.length,
      rejectedBySchema,
      duplicateItems: normalized.length - deduped.length,
      companyMatched: matched.length,
      rejectedByCompany: companyRejected,
      companyConfirmed,
      companyProviderConstrainedUnknown,
      companyRejected
    }
  };
}

/**
 * Read dataset items with a small bounded retry. Immediately after a run
 * reports SUCCEEDED, the dataset read can transiently return zero items while
 * Apify reaches consistency — a few short exponential backoffs avoid finalizing
 * a search (or wasting a paid re-run) on that empty read. Never loops forever.
 */
export async function readDatasetItemsWithRetry(
  read: () => Promise<RawProfile[]>,
  options: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<RawProfile[]> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let items: RawProfile[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    items = await read();
    if (items.length > 0) {
      return items;
    }
    if (attempt < attempts - 1) {
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  return items;
}

// Abstraction over the raw Apify run so the service logic (normalization,
// filtering, dedupe) is testable without the network or the apify-client SDK.
export interface ApifyRunner {
  run(actorId: string, input: ApifyActorInput): Promise<{
    runId: string | null;
    datasetId: string | null;
    items: RawProfile[];
    /** Terminal run status (SUCCEEDED, FAILED, ABORTED, TIMED-OUT, …). */
    status?: string | null;
    /** Actor status message (e.g. "free user run limit reached"). */
    statusMessage?: string | null;
  }>;
  /**
   * Read the items of an ALREADY-STORED dataset by its dataset id (never a run
   * id). Used by zero-result reprocessing so a successful past run can be
   * repaired without paying for a new actor run. Optional so lightweight test
   * runners are unaffected.
   */
  fetchDatasetItems?(datasetId: string): Promise<RawProfile[]>;
}

const APIFY_SUCCESS_STATUS = "SUCCEEDED";
// Quota / plan / abort phrasing that means the run never produced usable data,
// even when the actor exits "successfully" with zero items (the free-tier
// legacy actor-level "free user run limit reached" behavior).
const APIFY_LIMIT_PATTERN = /\b(limit|upgrade|paid plan|free user|quota|exceeded|insufficient|not enough credit)\b/i;

function describeApifyFailure(status: string | null, message: string): string {
  const base = message
    ? `LinkedIn profile search could not run: ${message}`
    : status
      ? `LinkedIn profile search did not complete (status ${status})`
      : "LinkedIn profile search did not complete";
  return APIFY_LIMIT_PATTERN.test(message)
    ? `${base}. Upgrade your Apify plan or set a different APIFY_API_TOKEN, then try again.`
    : `${base}.`;
}

/**
 * Throw a clear error when an Apify run did not actually return usable data, so
 * the pipeline surfaces a FAILED search instead of a silent "Ready" with zero
 * people. Covers both non-success terminal states and the actor-level free-tier
 * run limit (which can report SUCCEEDED with zero items + a status message).
 */
export function assertApifyRunUsable(run: { status?: string | null; statusMessage?: string | null; itemCount: number }): void {
  const status = run.status ?? null;
  const message = run.statusMessage?.trim() ?? "";
  const limitHit = message !== "" && APIFY_LIMIT_PATTERN.test(message);

  if ((status && status !== APIFY_SUCCESS_STATUS) || (run.itemCount === 0 && limitHit)) {
    throw new Error(describeApifyFailure(status, message));
  }
}

function assertDatasetDiagnosticsUsable(diagnostics: ApifyIngestionDiagnostics): void {
  if (diagnostics.diagnosticItems > 0 && process.env.NODE_ENV !== "test") {
    console.warn(
      `[apify-profile-search] Provider diagnostic rows. ${JSON.stringify({
        diagnosticItems: diagnostics.diagnosticItems,
        diagnosticCodes: diagnostics.diagnosticCodes,
        profileRows: diagnostics.profileRows
      })}`
    );
  }
  if (diagnostics.temporaryDiagnosticItems > 0) {
    throw new Error("LinkedIn profile search is temporarily unavailable. Please try again.");
  }
}

class ApifyClientRunner implements ApifyRunner {
  constructor(private readonly token: string) {}

  private async client() {
    // Imported lazily so test environments and the disabled feature path never
    // need the SDK loaded.
    const { ApifyClient } = await import("apify-client");
    return new ApifyClient({ token: this.token });
  }

  async run(actorId: string, input: ApifyActorInput) {
    const client = await this.client();
    const run = await client.actor(actorId).call(input);
    // Always the run's OWN default dataset — never a run id, never a previous
    // run's dataset.
    const datasetId = run.defaultDatasetId ?? null;
    let items: RawProfile[] = [];
    if (datasetId) {
      const read = async () => (await client.dataset(datasetId).listItems()).items as RawProfile[];
      // Only a SUCCEEDED run earns the consistency retry: it should have items,
      // so an empty first read is likely a transient propagation delay. A failed
      // run's empty dataset is genuine and is surfaced immediately.
      items = run.status === APIFY_SUCCESS_STATUS ? await readDatasetItemsWithRetry(read) : await read();
    }
    return {
      runId: run.id ?? null,
      datasetId,
      items,
      status: run.status ?? null,
      statusMessage: run.statusMessage ?? null
    };
  }

  async fetchDatasetItems(datasetId: string): Promise<RawProfile[]> {
    const client = await this.client();
    return readDatasetItemsWithRetry(async () => (await client.dataset(datasetId).listItems()).items as RawProfile[]);
  }
}

export class ApifyProfileSearchService {
  private readonly actorId: string;
  private readonly runner: ApifyRunner | null;

  constructor(options?: { token?: string; actorId?: string; runner?: ApifyRunner }) {
    const token = options?.token ?? env.APIFY_API_TOKEN;
    this.actorId = options?.actorId ?? env.APIFY_PROSPECT_ACTOR_ID;
    this.runner = options?.runner ?? (token ? new ApifyClientRunner(token) : null);
  }

  get configured(): boolean {
    return this.runner !== null;
  }

  /**
   * Run the actor, normalize + dedupe results, and reject profiles with an
   * explicit current-company contradiction. Missing employer metadata remains
   * distinguishable as provider-constrained unknown. Raw actor output is never
   * persisted — only NormalizedProfile leaves this method.
   */
  async searchProfiles(
    input: ApifyProfileSearchInput & { linkedinCompanyUrl?: string | null }
  ): Promise<ApifyProfileSearchResult> {
    if (!this.runner) {
      throw new Error("APIFY_API_TOKEN is not configured.");
    }

    const actorInput = buildActorInput({
      companyName: input.companyName,
      companyLinkedinUrl: input.companyLinkedinUrl ?? input.linkedinCompanyUrl ?? null,
      jobTitles: input.jobTitles,
      locations: input.locations,
      maxResults: input.maxResults
    });

    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[discover-provider-input] ${JSON.stringify({
          actorId: this.actorId,
          companyFilter: actorInput.currentCompanies ?? [],
          titleCount: actorInput.currentJobTitles?.length ?? 0,
          titles: actorInput.currentJobTitles ?? [],
          locations: actorInput.locations ?? [],
          maxItems: actorInput.maxItems,
          stage: input.stage ?? "EXACT"
        })}`
      );
    }

    const { runId, datasetId, items, status, statusMessage } = await this.runner.run(this.actorId, actorInput);
    assertApifyRunUsable({ status, statusMessage, itemCount: items.length });

    const targetedCompanyUrl = input.companyLinkedinUrl ?? input.linkedinCompanyUrl ?? null;
    const processed = processDatasetItems(
      items,
      {
        companyName: input.companyName,
        linkedinCompanyUrl: targetedCompanyUrl,
        providerConstrained: Boolean(input.companyName.trim())
      },
      input.maxResults
    );
    assertDatasetDiagnosticsUsable(processed.diagnostics);

    return {
      profiles: processed.profiles,
      runId,
      datasetId,
      totalFound: processed.diagnostics.profileRows,
      diagnostics: processed.diagnostics
    };
  }

  /**
   * Read a stored dataset's items for zero-result reprocessing. Reuses the
   * already-paid dataset — this NEVER starts a new actor run.
   */
  async fetchStoredDatasetItems(datasetId: string): Promise<RawProfile[]> {
    if (!this.runner?.fetchDatasetItems) {
      throw new Error("APIFY_API_TOKEN is not configured.");
    }
    return this.runner.fetchDatasetItems(datasetId);
  }
}
