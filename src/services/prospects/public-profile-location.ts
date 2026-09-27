import { evaluateDiscoverLocationMatch } from "@/services/prospects/discover-location-matching";
import { parseLocation, stripDiacritics } from "@/services/prospects/prospect-normalization";

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countries = new Map<string, string>();
for (let first = 65; first <= 90; first += 1) {
  for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second);
    const name = displayNames.of(code);
    if (!name || name === code || name === "Unknown Region") continue;
    countries.set(normalize(name), name);
    countries.set(code.toLowerCase(), name);
  }
}
countries.set("usa", "United States");
countries.set("u s", "United States");
countries.set("u s a", "United States");
countries.set("uk", "United Kingdom");
countries.set("u k", "United Kingdom");

function normalize(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function countryName(value: string): string | null {
  return countries.get(normalize(value)) ?? null;
}

function cleanEvidence(value: string, companyName?: string): string {
  let result = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (companyName?.trim()) {
    const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), " · ");
  }
  return result;
}

/** Conservative location extraction from sanitized public SERP evidence. */
export function extractPublicLocationEvidence(values: readonly string[], companyName?: string): string | null {
  for (const raw of values) {
    const current = cleanEvidence(raw, companyName).split(
      /\b(?:experience|education|previously|formerly|worked|past employment)\b|\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/i
    )[0];
    const segments = current.split(/[·|;!?]|\.{1,3}\s+/).map((value) => value.replace(/^\s*(?:location\s*:\s*)/i, "").trim());
    for (const segment of segments) {
      if (!segment || segment.length > 100) continue;
      const parts = segment.split(",").map((part) => part.trim()).filter(Boolean);
      const last = parts.at(-1) ?? segment;
      const country = countryName(last);
      if (country && parts.length === 1) return country;
      if (country && parts.length >= 2 && parts.length <= 4 && parts.every((part) => /^[\p{L}\p{M} .'-]+$/u.test(part))) {
        return [...parts.slice(0, -1), country].join(", ");
      }
    }
  }
  return null;
}

export function requestedCountryFallback(locations: readonly string[]): string | null {
  return locations.length === 1 ? countryName(locations[0]) : null;
}

export function resolvePublicLocation(input: {
  evidence: string | null;
  requestedLocations: readonly string[];
}): { accepted: boolean; contradiction: boolean; location: ReturnType<typeof parseLocation> } {
  const fallback = input.evidence ? null : requestedCountryFallback(input.requestedLocations);
  const raw = input.evidence ?? fallback;
  let location = parseLocation(raw);
  if (raw) {
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2 && !countryName(parts[1])) {
      location = { location: raw, city: parts[0], state: parts[1], country: null };
    }
  }
  if (input.requestedLocations.length === 0) return { accepted: true, contradiction: false, location };
  const evaluation = evaluateDiscoverLocationMatch({
    candidate: location,
    requestedLocations: input.requestedLocations,
    context: "CACHE"
  });
  return {
    accepted: evaluation.matches || Boolean(fallback),
    contradiction: evaluation.reason === "EXPLICIT_CONTRADICTION" || evaluation.reason === "NO_MATCH",
    location
  };
}
