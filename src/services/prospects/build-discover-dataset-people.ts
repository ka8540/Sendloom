import { env } from '@/lib/env';
import { coercePositionCategory } from '@/lib/prospect-enums';
import { nameStateFields } from './discover-name-contract';
import { normalizeTitle } from './prospect-normalization';
import type { NormalizedProfile } from './apify-profile-search';
import type { ResolvedCachePerson, ResolvedEmailFormat } from './discover-cache-service';
import { resolveCandidateEmail } from './email-generation-service';
import { combinedEmailConfidence } from './prospect-email-confidence';
export function buildDiscoverDatasetPeople(profiles: NormalizedProfile[], classifications: Map<string, { category: string }>, emailFormat: ResolvedEmailFormat): ResolvedCachePerson[] {
    const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
    const candidateConfidence = combinedEmailConfidence(emailFormat.emailDomainConfidence, emailFormat.patternConfidence);
    return profiles.map((profile) => {
      const category = coercePositionCategory(classifications.get(profile.normalizedTitle ?? normalizeTitle(profile.currentTitle ?? ""))?.category);
      const candidate = resolveCandidateEmail({
        firstName: profile.firstName,
        lastName: profile.lastName,
        ...nameStateFields(profile),
        domain: emailFormat.emailDomain,
        pattern: emailFormat.emailPattern,
        patternConfidence: candidateConfidence,
        allowLowConfidence
      });
      return {
        sourceProfileId: profile.sourceProfileId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        fullName: profile.fullName,
        ...nameStateFields(profile),
        currentTitle: profile.currentTitle,
        normalizedTitle: profile.normalizedTitle,
        positionCategory: category,
        location: profile.location,
        locationSource: profile.locationSource ?? null,
        country: profile.country,
        state: profile.state,
        city: profile.city,
        linkedinUrl: profile.linkedinUrl,
        inferredEmail: candidate.email,
        emailStatus: candidate.status,
        emailConfidence: candidate.confidence,
        emailPattern: candidate.email ? emailFormat.emailPattern : null,
        emailSource: candidate.email ? "PATTERN" : null
      };
    });
}
