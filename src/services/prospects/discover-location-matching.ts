import { stripDiacritics } from "@/services/prospects/prospect-normalization";

export type DiscoverLocationContext =
  | "CACHE"
  | "TRUSTED_PROVIDER"
  | "PUBLIC_INDEX_PROVIDER";
export type DiscoverLocationMatchReason =
  | "NO_CONSTRAINT"
  | "CONFIRMED"
  | "PROVIDER_CONSTRAINED_UNKNOWN"
  | "EXPLICIT_CONTRADICTION"
  | "MISSING_METADATA"
  | "NO_MATCH";

export type DiscoverLocationCandidate = {
  location?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  linkedinUrl?: string | null;
};

export type DiscoverLocationMatch = {
  matches: boolean;
  reason: DiscoverLocationMatchReason;
};

function normalizeGeography(value: string | null | undefined): string {
  return stripDiacritics(value ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCountryLookup(): {
  aliases: ReadonlyMap<string, string>;
  fullNames: ReadonlySet<string>;
} {
  const aliases = new Map<string, string>();
  const fullNames = new Set<string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

  // Intl already ships the ISO region data used by the runtime. Enumerating
  // alpha-2 values avoids maintaining a second country-name dictionary here.
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const displayName = displayNames.of(code);
      if (!displayName || displayName === code || displayName === "Unknown Region") continue;
      const normalizedName = normalizeGeography(displayName);
      fullNames.add(normalizedName);
      aliases.set(normalizedName, normalizedName);
      aliases.set(code.toLowerCase(), normalizedName);
    }
  }

  const unitedStates = aliases.get("united states") ?? "united states";
  aliases.set("usa", unitedStates);
  aliases.set("u s", unitedStates);
  aliases.set("u s a", unitedStates);
  const unitedKingdom = aliases.get("united kingdom") ?? "united kingdom";
  aliases.set("uk", unitedKingdom);
  aliases.set("u k", unitedKingdom);

  return { aliases, fullNames };
}

const COUNTRY_LOOKUP = buildCountryLookup();
const UNITED_STATES_COUNTRY_KEY = COUNTRY_LOOKUP.aliases.get("united states") ?? "united states";
const UNITED_STATES_ALIASES = new Set(["us", "usa", "u s", "u s a", "united states"]);
const UNITED_STATES_STATE_NAMES = new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "district of columbia",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming"
]);
const UNITED_STATES_STATE_CODES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo",
  "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa",
  "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy"
]);

// High-confidence non-US place names that can stand alone in LinkedIn's
// city/metro projection. This is intentionally conservative: an unknown city
// remains unknown rather than being guessed foreign.
const NON_US_PLACE_COUNTRIES = new Map<string, string>([
  ["uk", "united kingdom"],
  ["u k", "united kingdom"],
  ["bengaluru", "india"],
  ["bangalore", "india"],
  ["bangalore urban", "india"],
  ["mumbai", "india"],
  ["new delhi", "india"],
  ["hyderabad", "india"],
  ["pune", "india"],
  ["gurugram", "india"],
  ["toronto", "canada"],
  ["hong kong", "hong kong"],
  ["singapore", "singapore"],
  ["greater cheshire west and chester", "united kingdom"]
]);

function locationComponents(value: string): string[] {
  return value.split(",").map((component) => component.trim()).filter(Boolean);
}

function containsRequestedGeography(candidate: string, requested: string): boolean {
  return candidate === requested
    || candidate.startsWith(`${requested}, `)
    || candidate.endsWith(`, ${requested}`)
    || candidate.includes(`, ${requested}, `);
}

function countryKeyFromRequested(value: string): string | null {
  const components = locationComponents(value);
  const country = components.at(-1) ?? value;
  return COUNTRY_LOOKUP.aliases.get(country) ?? null;
}

function reliableCandidateCountry(candidate: DiscoverLocationCandidate): string | null {
  const country = normalizeGeography(candidate.country);
  const countryKey = COUNTRY_LOOKUP.aliases.get(country);
  const location = normalizeGeography(candidate.location);
  if (!location) return countryKey ?? null;
  const components = locationComponents(location);
  const lastComponent = components.at(-1) ?? "";
  const locationCountryKey = COUNTRY_LOOKUP.aliases.get(lastComponent);

  // A separately structured country is trustworthy. When it was parsed from
  // a short provider string, require either a full country name or a complete
  // city/state/country shape so values such as "CA" are not mistaken for
  // Canada when the provider only returned a US state abbreviation.
  if (countryKey && country !== lastComponent) return countryKey;
  if (countryKey && UNITED_STATES_ALIASES.has(country)) return countryKey;
  if (countryKey && components.length >= 3) return countryKey;
  if (countryKey && COUNTRY_LOOKUP.fullNames.has(country)) return countryKey;

  // A full country name at the end of the returned location is also explicit
  // evidence even when the provider omitted a separate country field.
  if (locationCountryKey && COUNTRY_LOOKUP.fullNames.has(lastComponent)) {
    return locationCountryKey;
  }
  return null;
}

function hasRecognizedUnitedStatesGeography(candidateValues: readonly string[]): boolean {
  return candidateValues.some((candidateValue) => {
    const components = locationComponents(candidateValue);
    if (components.some((component) => UNITED_STATES_STATE_NAMES.has(component))) {
      return true;
    }

    // Two-letter state codes are only useful in a city/state-shaped value.
    // A bare "IN" or "CA" is too ambiguous to establish US residence.
    return components.length >= 2
      && components.slice(1).some((component) => UNITED_STATES_STATE_CODES.has(component));
  });
}

function knownNonUsCountry(candidateValues: readonly string[]): string | null {
  for (const value of candidateValues) {
    for (const component of locationComponents(value)) {
      const direct = NON_US_PLACE_COUNTRIES.get(component);
      if (direct) return COUNTRY_LOOKUP.aliases.get(direct) ?? direct;
      for (const [place, country] of NON_US_PLACE_COUNTRIES) {
        if (component.startsWith(`${place} metropolitan area`)) {
          return COUNTRY_LOOKUP.aliases.get(country) ?? country;
        }
      }
    }
  }
  return null;
}

function linkedinHostnameCountry(linkedinUrl: string | null | undefined): string | null {
  if (!linkedinUrl) return null;
  try {
    const hostname = new URL(linkedinUrl).hostname.toLowerCase();
    if (hostname === "linkedin.com" || hostname === "www.linkedin.com") return null;
    if (!hostname.endsWith(".linkedin.com")) return null;
    const subdomain = hostname.slice(0, -".linkedin.com".length).split(".").at(-1) ?? "";
    if (!/^[a-z]{2}$/.test(subdomain) || subdomain === "www") return null;
    const regionCode = subdomain === "uk" ? "gb" : subdomain;
    return COUNTRY_LOOKUP.aliases.get(regionCode) ?? null;
  } catch {
    return null;
  }
}

/**
 * Runtime candidate-geography policy. This deliberately does not participate
 * in Discover cache fingerprinting: fingerprints remain exact, while stored or
 * provider-returned candidate metadata may be partial or more fully formatted.
 */
export function evaluateDiscoverLocationMatch(input: {
  candidate: DiscoverLocationCandidate;
  requestedLocations: readonly string[];
  context: DiscoverLocationContext;
}): DiscoverLocationMatch {
  const requested = input.requestedLocations.map(normalizeGeography).filter(Boolean);
  if (requested.length === 0) {
    return { matches: true, reason: "NO_CONSTRAINT" };
  }

  const candidateValues = [
    input.candidate.location,
    input.candidate.country,
    input.candidate.state,
    input.candidate.city
  ].map(normalizeGeography).filter(Boolean);
  const explicitCountry = reliableCandidateCountry(input.candidate);
  const hostnameCountry = linkedinHostnameCountry(input.candidate.linkedinUrl);

  const stringConfirmed = requested.some((requestedValue) =>
    candidateValues.some((candidateValue) =>
      containsRequestedGeography(candidateValue, requestedValue)
    )
  );
  const requestedCountryKeys = new Set(
    requested.map(countryKeyFromRequested).filter((value): value is string => Boolean(value))
  );
  const countryConfirmed = Boolean(
    explicitCountry && requestedCountryKeys.has(explicitCountry)
  );
  const unitedStatesGeographyConfirmed =
    requestedCountryKeys.has(UNITED_STATES_COUNTRY_KEY)
    && hasRecognizedUnitedStatesGeography(candidateValues);
  if (stringConfirmed || countryConfirmed || unitedStatesGeographyConfirmed) {
    return { matches: true, reason: "CONFIRMED" };
  }

  if (
    explicitCountry
    && requestedCountryKeys.size > 0
    && !requestedCountryKeys.has(explicitCountry)
  ) {
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  if (
    input.context === "PUBLIC_INDEX_PROVIDER"
    && hostnameCountry
    && requestedCountryKeys.size > 0
    && !requestedCountryKeys.has(hostnameCountry)
  ) {
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  const inferredForeignCountry = knownNonUsCountry(candidateValues);
  if (
    inferredForeignCountry
    && requestedCountryKeys.size > 0
    && !requestedCountryKeys.has(inferredForeignCountry)
  ) {
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  if (input.context === "TRUSTED_PROVIDER") {
    // A genuinely structured provider may make its applied location filter
    // authoritative even when the returned projection omits geography.
    return { matches: true, reason: "MISSING_METADATA" };
  }

  if (input.context === "PUBLIC_INDEX_PROVIDER") {
    // The Dami request itself was narrowly constrained by canonical company,
    // one title stage, and requested location. With no explicit contradictory
    // geography (including a foreign LinkedIn country subdomain), missing or
    // city-only metadata may survive as UNKNOWN for strict role validation.
    return { matches: true, reason: "PROVIDER_CONSTRAINED_UNKNOWN" };
  }

  // Cache reuse remains conservative because it does not retain provider-query
  // provenance strongly enough to authorize unknown geography.
  return {
    matches: false,
    reason: candidateValues.length === 0 ? "MISSING_METADATA" : "NO_MATCH"
  };
}
