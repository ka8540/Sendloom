import { canonicalizeLinkedInProfileUrl } from "./linkedin-profile-url";
import type { ProspectPerson } from '@prisma/client';
import type { ResolvedCachePerson } from './discover-cache-service';
import { personIdentityKeys } from './discover-person-identity';

/** Keep the existing durable database id and stronger metadata; query eligibility was checked before reuse. */
export function reuseExistingPeople(people: ResolvedCachePerson[], existing: ProspectPerson[], companyId: string): ResolvedCachePerson[] {
  const byIdentity = new Map<string, ProspectPerson>();
  for (const person of existing) for (const key of personIdentityKeys(person)) byIdentity.set(key, person);
  return people.map(person => {
    const stored = personIdentityKeys(person).map(key => byIdentity.get(key)).find(Boolean);
    if (!stored) {
      const canonical = canonicalizeLinkedInProfileUrl(person.linkedinUrl);
      return canonical ? { ...person, ...canonical } : person;
    }
    if (stored.companyId !== companyId) return { ...person, sourceProfileId: stored.sourceProfileId };
    return { ...person, sourceProfileId: stored.sourceProfileId,
      firstName: stored.firstName, lastName: stored.lastName, fullName: stored.fullName,
      sourceName: stored.sourceName, nameNormalization: stored.nameNormalization,
      currentTitle: stored.currentTitle ?? person.currentTitle, normalizedTitle: stored.normalizedTitle ?? person.normalizedTitle,
      location: stored.location ?? person.location, city: stored.city ?? person.city,
      state: stored.state ?? person.state, country: stored.country ?? person.country,
      linkedinUrl: stored.linkedinUrl,
      inferredEmail: stored.inferredEmail, emailStatus: stored.emailStatus, emailConfidence: stored.emailConfidence,
      emailPattern: stored.emailPattern, emailSource: stored.emailSource };
  });
}
