import { validateCurrentEmployment } from "@/services/prospects/current-employment-evidence";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { parseLinkedInSearchResult } from "@/services/prospects/linkedin-search-result-parser";
import { extractPublicLocationEvidence, resolvePublicLocation } from "@/services/prospects/public-profile-location";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import type { NormalizedProfile } from "@/services/prospects/apify-profile-search";

export type PublicSearchMetadata = { url: string; title: string; description: string };
export type PublicProfileDiagnostics = {
  linkedInCandidates: number;
  currentEmploymentAccepted: number;
  formerEmployeeRejected: number;
  companyContradictionRejected: number;
  companyInsufficientRejected: number;
  locationAccepted: number;
  locationMissing: number;
  locationContradictionRejected: number;
  roleRejected: number;
  duplicateRejected: number;
};

export function emptyPublicProfileDiagnostics(): PublicProfileDiagnostics {
  return { linkedInCandidates: 0, currentEmploymentAccepted: 0, formerEmployeeRejected: 0,
    companyContradictionRejected: 0, companyInsufficientRejected: 0, locationAccepted: 0,
    locationMissing: 0, locationContradictionRejected: 0, roleRejected: 0, duplicateRejected: 0 };
}

/** Public search metadata is candidate evidence only; role authorization follows in the orchestrator. */
export function validatePublicProfileSearchResults(
  results: readonly PublicSearchMetadata[],
  input: { companyName: string; locations: string[] },
  counts: PublicProfileDiagnostics
): NormalizedProfile[] {
  const seen = new PersonIdentitySet();
  const profiles: NormalizedProfile[] = [];

  for (const row of results) {
    const result: BrightOrganicResult = {
      title: row.title,
      url: row.url,
      rawUrl: row.url,
      displayedUrl: null,
      snippet: row.description,
      evidence: [row.title, row.description]
    };
    const profile = parseLinkedInSearchResult(result, { expectedCompanyName: input.companyName });
    if (!profile) continue;
    counts.linkedInCandidates += 1;
    if (!seen.addIfNew(profile)) {
      counts.duplicateRejected += 1;
      continue;
    }
    const employment = validateCurrentEmployment(result, profile, input.companyName);
    if (employment.decision !== "CURRENT") {
      if (employment.decision === "FORMER") counts.formerEmployeeRejected += 1;
      else if (employment.decision === "CONTRADICTORY") counts.companyContradictionRejected += 1;
      else counts.companyInsufficientRejected += 1;
      continue;
    }
    counts.currentEmploymentAccepted += 1;
    const evidence = extractPublicLocationEvidence([row.title, row.description], input.companyName);
    const location = resolvePublicLocation({ evidence, requestedLocations: input.locations });
    if (!location.accepted) {
      if (location.contradiction) counts.locationContradictionRejected += 1;
      else counts.locationMissing += 1;
      continue;
    }
    if (location.location.location) counts.locationAccepted += 1;
    else counts.locationMissing += 1;
    profiles.push({ ...profile, ...location.location });
  }
  return profiles;
}
