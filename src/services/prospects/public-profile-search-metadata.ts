import { validateCurrentEmployment } from "@/services/prospects/current-employment-evidence";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import { parseLinkedInSearchResult } from "@/services/prospects/linkedin-search-result-parser";
import { extractPublicLocationEvidence, resolvePublicLocation } from "@/services/prospects/public-profile-location";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import type { NormalizedProfile } from "@/services/prospects/apify-profile-search";
import {
  type DiscoverCandidateEligibilityPort,
  type DiscoverCandidateProvider,
  type DiscoverCandidateSearchIntent,
  emptyCandidateJudgeDiagnostics,
  type DiscoverCandidateJudgeDiagnostics
} from "@/services/prospects/discover-candidate-eligibility-service";
import type { AiCallBudget } from "@/services/prospects/prospect-ai";
import { deterministicCategory } from "@/services/prospects/role-classification-service";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import { parseLocation } from "@/services/prospects/prospect-normalization";

export type PublicSearchMetadata = { url: string; title: string; description: string };
export type PublicProfileDiagnostics = Partial<DiscoverCandidateJudgeDiagnostics> & {
  linkedInCandidates: number;
  currentEmploymentAccepted: number;
  formerEmployeeRejected: number;
  companyContradictionRejected: number;
  companyInsufficientRejected: number;
  locationAccepted: number;
  locationMissing: number;
  locationContradictionRejected: number;
  roleRejected?: number;
  duplicateRejected: number;
};

export function emptyPublicProfileDiagnostics(): PublicProfileDiagnostics {
  return { ...emptyCandidateJudgeDiagnostics(), linkedInCandidates: 0, currentEmploymentAccepted: 0, formerEmployeeRejected: 0,
    companyContradictionRejected: 0, companyInsufficientRejected: 0, locationAccepted: 0,
    locationMissing: 0, locationContradictionRejected: 0, roleRejected: 0, duplicateRejected: 0 };
}

export async function judgePublicProfileSearchResults(
  results: readonly PublicSearchMetadata[],
  input: {
    companyName: string;
    locations: string[];
    requestedTitles: string[];
    provider: DiscoverCandidateProvider;
    searchId?: string | null;
    budget: AiCallBudget;
  },
  counts: PublicProfileDiagnostics,
  eligibility: DiscoverCandidateEligibilityPort,
  deterministicFallback?: () => Promise<NormalizedProfile[]>
): Promise<NormalizedProfile[]> {
  if (!eligibility.enabled) return validatePublicProfileSearchResults(results, input, counts);

  const prepared = results.map((row, index) => {
    const result: BrightOrganicResult = {
      title: row.title,
      url: row.url,
      rawUrl: row.url,
      displayedUrl: null,
      snippet: row.description,
      evidence: [row.title, row.description]
    };
    const profile = parseLinkedInSearchResult(result, { expectedCompanyName: input.companyName });
    if (profile) counts.linkedInCandidates += 1;
    const employment = profile
      ? validateCurrentEmployment(result, profile, input.companyName)
      : { decision: "INSUFFICIENT" as const, requestedCompanySignals: 0, contradictorySignals: 0, historicalSignals: 0 };
    if (employment.decision === "CURRENT") counts.currentEmploymentAccepted += 1;
    else if (employment.decision === "FORMER") counts.formerEmployeeRejected += 1;
    else if (employment.decision === "CONTRADICTORY") counts.companyContradictionRejected += 1;
    else counts.companyInsufficientRejected += 1;
    const locationEvidence = extractPublicLocationEvidence([row.title, row.description], input.companyName);
    const location = resolvePublicLocation({ evidence: locationEvidence, requestedLocations: input.locations });
    if (location.accepted) {
      if (location.location.location) counts.locationAccepted += 1;
      else counts.locationMissing += 1;
    } else if (location.contradiction) counts.locationContradictionRejected += 1;
    else counts.locationMissing += 1;
    const deterministicAccepted = Boolean(profile) && employment.decision === "CURRENT" && location.accepted;
    return {
      candidateId: `${input.provider}:${index}`,
      row,
      profile,
      location,
      locationEvidence,
      deterministicAccepted,
      evidence: {
        candidateId: `${input.provider}:${index}`,
        provider: input.provider,
        name: profile?.sourceName ?? profile?.fullName ?? null,
        url: row.url || null,
        providerTitle: row.title || null,
        providerDescription: row.description || null,
        parsedTitle: profile?.currentTitle ?? null,
        parsedCompany: profile?.currentCompanyName ?? null,
        parsedLocation: locationEvidence,
        employmentParserDecision: employment.decision,
        locationParserDecision: location.accepted ? "MATCH" as const : location.contradiction ? "MISMATCH" as const : "MISSING" as const,
        roleClassifierCategory: profile?.currentTitle
          ? deterministicCategory(normalizeTitle(profile.currentTitle))
          : null
      }
    };
  });
  const judged = await eligibility.evaluate({
    intent: { company: input.companyName, roles: input.requestedTitles, locations: input.locations } satisfies DiscoverCandidateSearchIntent,
    candidates: prepared.map((candidate) => candidate.evidence),
    budget: input.budget,
    searchId: input.searchId
  });
  for (const key of Object.keys(judged.diagnostics) as Array<keyof DiscoverCandidateJudgeDiagnostics>) {
    counts[key] = (counts[key] ?? 0) + judged.diagnostics[key];
  }

  const fallbackProfiles = deterministicFallback ? await deterministicFallback() : null;
  const fallbackByIdentity = new Map(
    fallbackProfiles?.map((profile) => [profile.sourceProfileId, profile]) ?? []
  );

  const seen = new PersonIdentitySet();
  const profiles: NormalizedProfile[] = [];
  for (const candidate of prepared) {
    const deterministicProfile = candidate.profile
      ? fallbackByIdentity.get(candidate.profile.sourceProfileId)
      : undefined;
    const deterministicAccepted = fallbackProfiles
      ? Boolean(deterministicProfile)
      : candidate.deterministicAccepted;
    const aiDecision = judged.decisions.get(candidate.candidateId)?.decision;
    const aiAccepts = aiDecision === "ACCEPT";
    if (aiAccepts && !deterministicAccepted) {
      counts.aiAcceptedDeterministicWouldRejectCount = (counts.aiAcceptedDeterministicWouldRejectCount ?? 0) + 1;
    }
    if (aiDecision === "REJECT" && deterministicAccepted) {
      counts.aiRejectedDeterministicWouldAcceptCount = (counts.aiRejectedDeterministicWouldAcceptCount ?? 0) + 1;
    }
    const accepted = judged.shadow
      ? deterministicAccepted
      : aiDecision === "ACCEPT"
        ? true
        : aiDecision === "REJECT"
          ? false
          : deterministicAccepted;
    if (!accepted) continue;
    if (!candidate.profile) {
      if (aiAccepts && !judged.shadow) {
        counts.aiAcceptedButUnpersistableCount = (counts.aiAcceptedButUnpersistableCount ?? 0) + 1;
      }
      continue;
    }
    const authoritativeProfile = aiAccepts && !judged.shadow
      ? candidate.profile
      : deterministicProfile ?? candidate.profile;
    const profile = {
      ...authoritativeProfile,
      ...(aiAccepts && !judged.shadow ? parseLocation(candidate.locationEvidence) : deterministicProfile ? {} : candidate.location.location),
      discoverEligibility: aiAccepts && !judged.shadow ? "AI_ACCEPT" as const : "DETERMINISTIC_FALLBACK" as const,
      discoverDeterministicEligibilityAccepted: deterministicAccepted
    };
    if (!seen.addIfNew(profile)) {
      counts.duplicateRejected += 1;
      continue;
    }
    profiles.push(profile);
  }
  return profiles;
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
