import { env } from "@/lib/env";
import {
  buildFullName,
  normalizeCompanyName,
  normalizeTitle,
  parseLocation
} from "@/services/prospects/prospect-normalization";

// Minimal normalized profile. We deliberately discard everything Sendloom does
// not need (photos, phone numbers, personal emails, education, full employment
// history, biographies, posts, connections) right at the ingestion boundary.
export type NormalizedProfile = {
  sourceProfileId: string;
  firstName: string;
  lastName: string;
  fullName: string;
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
};

export type ApifyProfileSearchResult = {
  profiles: NormalizedProfile[];
  runId: string | null;
  datasetId: string | null;
  totalFound: number;
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
    startPage: 1,
    autoQuerySegmentation: false
  };

  if (input.companyLinkedinUrl) {
    actorInput.currentCompanies = [input.companyLinkedinUrl];
  }

  return actorInput;
}

type RawProfile = Record<string, unknown>;

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

function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Normalize one raw actor item into a NormalizedProfile, or null if it lacks
 * the minimum professional identity we require (a name and a profile URL).
 */
export function normalizeProfile(raw: RawProfile): NormalizedProfile | null {
  const linkedinUrl = asString(raw.linkedinUrl) ?? asString(raw.profileUrl) ?? asString(raw.url);
  if (!linkedinUrl) {
    return null;
  }

  let firstName = asString(raw.firstName);
  let lastName = asString(raw.lastName);
  const fullNameRaw = asString(raw.fullName) ?? asString(raw.name);

  if ((!firstName || !lastName) && fullNameRaw) {
    const split = splitFullName(fullNameRaw);
    firstName = firstName ?? split.firstName;
    lastName = lastName ?? split.lastName;
  }

  if (!firstName) {
    return null;
  }
  lastName = lastName ?? "";

  const sourceProfileId =
    asString(raw.id) ??
    asString(raw.publicIdentifier) ??
    asString(raw.profileId) ??
    linkedinUrl.replace(/\/+$/, "").split("/").pop() ??
    linkedinUrl;

  const position = readCurrentPosition(raw);
  const headline = asString(raw.headline);
  const currentTitle = position.title ?? headline;
  const fullName = fullNameRaw ?? buildFullName(firstName, lastName);
  const parsedLocation = parseLocation(readLocation(raw));

  return {
    sourceProfileId,
    firstName,
    lastName,
    fullName,
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

/**
 * Decide whether a profile's current employer matches the resolved company.
 * If neither a company URL nor a company name can be compared, the profile is
 * kept (we cannot prove a mismatch). A profile with a clearly different current
 * company is excluded.
 */
export function currentCompanyMatches(
  profile: NormalizedProfile,
  target: { companyName: string; linkedinCompanyUrl?: string | null }
): boolean {
  const targetSlug = companyUrlSlug(target.linkedinCompanyUrl);
  const profileSlug = companyUrlSlug(profile.currentCompanyUrl);
  if (targetSlug && profileSlug) {
    return targetSlug === profileSlug;
  }

  if (profile.currentCompanyName && target.companyName) {
    return normalizeCompanyName(profile.currentCompanyName) === normalizeCompanyName(target.companyName);
  }

  return true;
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

// Abstraction over the raw Apify run so the service logic (normalization,
// filtering, dedupe) is testable without the network or the apify-client SDK.
export interface ApifyRunner {
  run(actorId: string, input: ApifyActorInput): Promise<{ runId: string | null; datasetId: string | null; items: RawProfile[] }>;
}

class ApifyClientRunner implements ApifyRunner {
  constructor(private readonly token: string) {}

  async run(actorId: string, input: ApifyActorInput) {
    // Imported lazily so test environments and the disabled feature path never
    // need the SDK loaded.
    const { ApifyClient } = await import("apify-client");
    const client = new ApifyClient({ token: this.token });
    const run = await client.actor(actorId).call(input);
    const datasetId = run.defaultDatasetId ?? null;
    const items = datasetId ? (await client.dataset(datasetId).listItems()).items : [];
    return {
      runId: run.id ?? null,
      datasetId,
      items: items as RawProfile[]
    };
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
      maxResults: input.maxResults
    });

    const { runId, datasetId, items } = await this.runner.run(this.actorId, actorInput);

    const normalized = items
      .map((item) => normalizeProfile(item))
      .filter((profile): profile is NormalizedProfile => profile !== null);

    const deduped = dedupeProfiles(normalized);
    const matched = deduped.filter((profile) =>
      currentCompanyMatches(profile, {
        companyName: input.companyName,
        linkedinCompanyUrl: input.companyLinkedinUrl ?? input.linkedinCompanyUrl ?? null
      })
    );

    return {
      profiles: matched.slice(0, Math.max(1, Math.floor(input.maxResults))),
      runId,
      datasetId,
      totalFound: items.length
    };
  }
}
