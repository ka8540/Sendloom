import { createHash } from "node:crypto";

import {
  getCanonicalCompanyKey,
  normalizeLinkedinCompanySlug
} from "@/services/prospects/canonical-company";
import { normalizeTitle, stripDiacritics } from "@/services/prospects/prospect-normalization";

/**
 * Canonical fingerprint for the shared Discover result cache.
 *
 * Two requests share a cache entry only when their canonical filters match
 * EXACTLY: same resolved company identity, same normalized+sorted role set, same
 * normalized+sorted location set, the same fixed result limit, and the same
 * cache schema version. Array order and duplicates never create separate
 * entries; a different company, role, location, limit, or version always does.
 * We intentionally do NOT add broad fuzzy/geographic matching that could change
 * what a search means (e.g. California is never treated as United States).
 */
export type DiscoverFingerprintInput = {
  companyKey: string;
  roles: string[];
  locations: string[];
  resultLimit: number;
  cacheVersion: string;
};

export type CompanyKeySource = {
  linkedinCompanyUrl?: string | null;
  officialWebsiteDomain?: string | null;
  officialDomain?: string | null;
  normalizedName: string;
};

export { normalizeLinkedinCompanySlug };

/**
 * Shared canonical company key. This delegates to the same domain-first helper
 * used by ProspectCompany persistence so fingerprints and tenant-owned company
 * rows cannot assign contradictory identities to one resolved company.
 */
export function canonicalCompanyKey(source: CompanyKeySource): string {
  return getCanonicalCompanyKey({
    linkedinCompanyUrl: source.linkedinCompanyUrl,
    officialWebsiteDomain: source.officialWebsiteDomain,
    officialDomain: source.officialDomain,
    normalizedName: source.normalizedName
  });
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

/** Normalize search roles with the SAME title normalization used elsewhere. */
export function normalizeRolesForCache(titles: string[]): string[] {
  return uniqueSorted(titles.map((title) => normalizeTitle(title)));
}

/** Trim/casefold/dedupe/sort locations. No geographic equivalence is invented. */
export function normalizeLocationsForCache(locations: string[]): string[] {
  return uniqueSorted(
    locations.map((location) =>
      stripDiacritics(location).toLowerCase().replace(/\s+/g, " ").trim()
    )
  );
}

export function buildDiscoverFingerprintInput(params: {
  company: CompanyKeySource;
  roles: string[];
  locations: string[];
  resultLimit: number;
  cacheVersion: string;
}): DiscoverFingerprintInput {
  return {
    companyKey: canonicalCompanyKey(params.company),
    roles: normalizeRolesForCache(params.roles),
    locations: normalizeLocationsForCache(params.locations),
    resultLimit: params.resultLimit,
    cacheVersion: params.cacheVersion
  };
}

/**
 * Deterministic SHA-256 hash of the canonical input. Arrays are re-sorted here
 * too so the hash is independent of how the input was constructed.
 */
export function fingerprintHash(input: DiscoverFingerprintInput): string {
  const canonical = JSON.stringify({
    companyKey: input.companyKey,
    roles: [...input.roles].sort(),
    locations: [...input.locations].sort(),
    resultLimit: input.resultLimit,
    cacheVersion: input.cacheVersion
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Convenience: build the canonical input and hash it in one step. */
export function computeDiscoverFingerprint(params: {
  company: CompanyKeySource;
  roles: string[];
  locations: string[];
  resultLimit: number;
  cacheVersion: string;
}): { input: DiscoverFingerprintInput; fingerprint: string } {
  const input = buildDiscoverFingerprintInput(params);
  return { input, fingerprint: fingerprintHash(input) };
}
