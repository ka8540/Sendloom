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
};

export type ApifyProfileSearchInput = {
  companyName: string;
  companyLinkedinUrl?: string | null;
  jobTitles: string[];
  locations: string[];
  maxResults: number;
  /**
   * 1-based provider page to start from (25 results per page). Defaults to 1.
   * "Add 10 more" passes the saved continuation page so a follow-up search
   * resumes after the pages already fetched instead of restarting at page 1.
   */
  startPage?: number;
};

export type ApifyProfileSearchResult = {
  profiles: NormalizedProfile[];
  runId: string | null;
  datasetId: string | null;
  totalFound: number;
  /** Per-stage ingestion counters (safe counts only, for diagnostics/logging). */
  diagnostics: ApifyIngestionDiagnostics;
};

// The shape we actually run the Apify actor with. `currentCompanies` is only
// included when we resolved a LinkedIn company URL.
export type ApifyActorInput = {
  profileScraperMode: "Full";
  currentCompanies?: string[];
  currentJobTitles: string[];
  locations: string[];
  maxItems: number;
  takePages: number;
  startPage: number;
  autoQuerySegmentation: false;
};

/**
 * Map a resolved prospect search into the LinkedIn profile-search actor input.
 * `takePages` is always at least 1 (25 results per page).
 */
export function buildActorInput(input: ApifyProfileSearchInput): ApifyActorInput {
  const maxItems = Math.max(1, Math.floor(input.maxResults));
  const actorInput: ApifyActorInput = {
    profileScraperMode: "Full",
    currentJobTitles: input.jobTitles,
    locations: input.locations,
    maxItems,
    takePages: Math.max(1, Math.ceil(maxItems / 25)),
    startPage: Math.max(1, Math.floor(input.startPage ?? 1)),
    autoQuerySegmentation: false
  };

  if (input.companyLinkedinUrl) {
    actorInput.currentCompanies = [input.companyLinkedinUrl];
  }

  return actorInput;
}

export type RawProfile = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function readLocation(raw: RawProfile): string | null {
  const direct = asString(raw.location);
  if (direct) {
    return direct;
  }
  const loc = raw.location;
  if (loc && typeof loc === "object") {
    const obj = loc as Record<string, unknown>;
    return asString(obj.linkedinText) ?? asString(obj.text) ?? asString(obj.parsed) ?? null;
  }
  return asString(raw.locationName) ?? asString(raw.geoRegion) ?? null;
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
  const linkedinUrl = asString(raw.linkedinUrl) ?? asString(raw.profileUrl) ?? asString(raw.url);
  if (!linkedinUrl) {
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

  const position = readCurrentPosition(raw);
  const headline = asString(raw.headline);
  const currentTitle = position.title ?? headline;
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
    currentCompanyName: position.companyName ?? asString(raw.companyName) ?? asString(raw.currentCompany),
    currentCompanyUrl: position.companyUrl ?? asString(raw.companyLinkedinUrl)
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

/**
 * Alias-tolerant employer-name comparison. Accepts the same employer written
 * with different punctuation, corporate suffixes, spacing, or a shortened form
 * that stops at a word boundary ("JPMorgan" for "JPMorgan Chase & Co."), while
 * still rejecting lookalike prefixes of an unrelated single-word name
 * ("Apple" never matches "Applebee's").
 */
export function companyNamesAliasMatch(a: string, b: string): boolean {
  const keyA = companyAliasKey(a);
  const keyB = companyAliasKey(b);
  if (!keyA.squashed || !keyB.squashed) {
    return false;
  }
  if (keyA.squashed === keyB.squashed) {
    return true;
  }
  const [short, long] = keyA.squashed.length <= keyB.squashed.length ? [keyA, keyB] : [keyB, keyA];
  return (
    short.squashed.length >= MIN_ALIAS_PREFIX_LENGTH &&
    long.squashed.startsWith(short.squashed) &&
    long.boundaries.has(short.squashed.length)
  );
}

/**
 * Decide whether a profile's current employer matches the resolved company.
 * If neither a company URL nor a company name can be compared, the profile is
 * excluded. Prospect searches should never fill a graph from a broad title-only
 * scrape when we cannot verify the current employer.
 *
 * A LinkedIn company-URL identity match is the strongest signal (the actor was
 * already queried by that URL). Slugs are compared on their normalized
 * alphanumeric form because LinkedIn aliases punctuation-variant slugs to the
 * same company. When slugs are unavailable or disagree, the employer NAME is
 * still compared alias-tolerantly — a slug alias the normalizer cannot relate
 * must not reject an employee whose employer name plainly matches.
 */
export function currentCompanyMatches(
  profile: NormalizedProfile,
  target: { companyName: string; linkedinCompanyUrl?: string | null }
): boolean {
  const targetSlug = normalizedCompanySlug(target.linkedinCompanyUrl);
  const profileSlug = normalizedCompanySlug(profile.currentCompanyUrl);
  if (targetSlug && profileSlug && targetSlug === profileSlug) {
    return true;
  }

  if (profile.currentCompanyName && target.companyName) {
    return companyNamesAliasMatch(profile.currentCompanyName, target.companyName);
  }

  return false;
}

/** Remove duplicate profiles, preferring the first occurrence. */
export function dedupeProfiles(profiles: NormalizedProfile[]): NormalizedProfile[] {
  const seen = new Set<string>();
  const result: NormalizedProfile[] = [];
  for (const profile of profiles) {
    const key = profile.sourceProfileId || profile.linkedinUrl;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(profile);
  }
  return result;
}

/**
 * Privacy-safe, per-stage ingestion counters for one dataset. Counts only —
 * never names, emails, URLs, or raw items — so they are safe to log and audit.
 */
export type ApifyIngestionDiagnostics = {
  itemsReturned: number;
  parsedCandidates: number;
  rejectedBySchema: number;
  duplicateItems: number;
  companyMatched: number;
  rejectedByCompany: number;
};

export type ProcessedDatasetItems = {
  profiles: NormalizedProfile[];
  diagnostics: ApifyIngestionDiagnostics;
};

/**
 * Normalize, dedupe, and company-filter raw dataset items. One malformed item
 * only increments a rejection counter — it never fails the batch. Shared by the
 * live search path and stored-dataset reprocessing so both apply identical
 * eligibility rules.
 */
export function processDatasetItems(
  items: RawProfile[],
  target: { companyName: string; linkedinCompanyUrl?: string | null },
  maxResults: number
): ProcessedDatasetItems {
  const normalized: NormalizedProfile[] = [];
  let rejectedBySchema = 0;
  for (const item of items) {
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
  const matched = deduped.filter((profile) => currentCompanyMatches(profile, target));

  return {
    profiles: matched.slice(0, Math.max(1, Math.floor(maxResults))),
    diagnostics: {
      itemsReturned: items.length,
      parsedCandidates: normalized.length,
      rejectedBySchema,
      duplicateItems: normalized.length - deduped.length,
      companyMatched: matched.length,
      rejectedByCompany: deduped.length - matched.length
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
// "free user run limit reached" case from harvestapi/linkedin-profile-search).
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
   * Run the actor, normalize + dedupe results, and exclude profiles whose
   * current company does not match the resolved company. Raw actor output is
   * never persisted — only NormalizedProfile leaves this method.
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
      maxResults: input.maxResults,
      startPage: input.startPage
    });

    const { runId, datasetId, items, status, statusMessage } = await this.runner.run(this.actorId, actorInput);
    assertApifyRunUsable({ status, statusMessage, itemCount: items.length });

    const processed = processDatasetItems(
      items,
      {
        companyName: input.companyName,
        linkedinCompanyUrl: input.companyLinkedinUrl ?? input.linkedinCompanyUrl ?? null
      },
      input.maxResults
    );

    return {
      profiles: processed.profiles,
      runId,
      datasetId,
      totalFound: items.length,
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
