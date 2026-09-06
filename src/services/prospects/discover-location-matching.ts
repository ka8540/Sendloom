import { stripDiacritics, parseLocation } from "@/services/prospects/prospect-normalization";

export type DiscoverLocationContext = "CACHE" | "PROVIDER" | "PUBLIC";
export type DiscoverLocationMatchReason =
  | "NO_CONSTRAINT"
  | "CONFIRMED"
  | "EXPLICIT_CONTRADICTION"
  | "MISSING_METADATA"
  | "NO_MATCH";

export type DiscoverLocationCandidate = {
  location?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
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

  return { aliases, fullNames };
}

const COUNTRY_LOOKUP = buildCountryLookup();

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
  if (countryKey && components.length >= 3) return countryKey;
  if (countryKey && COUNTRY_LOOKUP.fullNames.has(country)) return countryKey;

  // A full country name at the end of the returned location is also explicit
  // evidence even when the provider omitted a separate country field.
  if (locationCountryKey && COUNTRY_LOOKUP.fullNames.has(lastComponent)) {
    return locationCountryKey;
  }
  // Reuse the same parser as ingress: "Dallas, Texas" supplies a known state,
  // not a fabricated requested country. Explicit countries above always win.
  const inferred = parseLocation(candidate.location);
  if (inferred.country === "United States" && inferred.state) return "united states";
  return null;
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
  if (stringConfirmed || countryConfirmed) {
    return { matches: true, reason: "CONFIRMED" };
  }

  if (
    explicitCountry
    && requestedCountryKeys.size > 0
    && !requestedCountryKeys.has(explicitCountry)
  ) {
    return { matches: false, reason: "EXPLICIT_CONTRADICTION" };
  }

  if (input.context === "PUBLIC") {
    // Keyword-extracted SERP metadata cannot supply trusted provider location
    // constraints, and absence of geography is not evidence of a contradictory
    // geography. Only an explicit contradiction rejects here; missing or
    // unconfirmable metadata passes and is counted separately by the caller.
    return {
      matches: true,
      reason: candidateValues.length === 0 ? "MISSING_METADATA" : "NO_MATCH"
    };
  }

  if (input.context === "PROVIDER") {
    // The paid provider run already carried the requested location constraint.
    // Incomplete returned metadata is absence of confirmation, not evidence of
    // a contradictory geography.
    return { matches: true, reason: "MISSING_METADATA" };
  }

  return {
    matches: false,
    reason: candidateValues.length === 0 ? "MISSING_METADATA" : "NO_MATCH"
  };
}
