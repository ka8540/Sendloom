import type { PrismaClient } from '@prisma/client';
import { deterministicCategory } from './role-classification-service';
import { deriveRoleIntent, decideRoleMatch } from './role-semantic-policy';
import { evaluateDiscoverLocationMatch } from './discover-location-matching';
import { normalizeTitle } from './prospect-normalization';
import { reuseExistingPeople } from './discover-existing-person';
import type { ResolvedCachePerson } from './discover-cache-service';

/** The existing role-family policy, without embeddings or AI on a processed pool read. */
export function publicPoolRoleMatches(title: string | null, roles: readonly string[]): boolean {
  const intent = (rawTitle: string) => deriveRoleIntent({ rawTitle,
    category: deterministicCategory(normalizeTitle(rawTitle)) ?? 'OTHER', confidence: 'HIGH' });
  const candidate = intent(title ?? '');
  return Boolean(candidate && roles.some(role => {
    const query = intent(role);
    return query && decideRoleMatch({ query, candidate, context: 'CACHE' });
  }));
}
export function filterPublicPoolPeople<T extends { currentTitle: string | null; location: string | null; country: string | null; state: string | null; city: string | null }>(
  people: T[], roles: readonly string[], locations: readonly string[]
): T[] {
  return people.filter(p => publicPoolRoleMatches(p.currentTitle, roles) && evaluateDiscoverLocationMatch({
    candidate: p, requestedLocations: locations, context: 'PUBLIC'
  }).matches);
}
export async function allocateEligiblePublicPeople(input: {
  prisma: PrismaClient; userId: string; companyId: string; people: ResolvedCachePerson[]; roles: string[]; locations: string[];
}): Promise<ResolvedCachePerson[]> {
  const existing = await input.prisma.prospectPerson.findMany({ where: { userId: input.userId } });
  const people = filterPublicPoolPeople(reuseExistingPeople(input.people, existing, input.companyId), input.roles, input.locations);
  const blocked = await input.prisma.suppression.findMany({ where: { userId: input.userId,
    email: { in: people.map(p => p.inferredEmail?.toLowerCase()).filter((v): v is string => Boolean(v)) } }, select: { email: true } });
  const emails = new Set(blocked.map(p => p.email.toLowerCase()));
  return people.filter(p => !p.inferredEmail || !emails.has(p.inferredEmail.toLowerCase()));
}
