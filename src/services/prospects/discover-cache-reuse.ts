import type { PositionCategory } from "@/lib/prospect-enums";
import { coercePositionCategory } from "@/lib/prospect-enums";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import { normalizeLocationsForCache } from "@/services/prospects/discover-cache-fingerprint";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";

export type RequestedRoleMatch = {
  normalizedTitle: string;
  category: PositionCategory;
};

/**
 * Filter a same-company shared people pool for the current Discover intent.
 *
 * Role reuse follows the existing title-classification categories. OTHER is
 * never treated as one broad role: unknown roles must match the normalized
 * title exactly. Location matching is deliberately conservative and only
 * accepts an exact normalized match against the stored full location, country,
 * state, or city. No geographic containment/equivalence is invented here.
 */
export function filterReusableDiscoverPeople(input: {
  people: readonly ResolvedCachePerson[];
  requestedRoles: readonly RequestedRoleMatch[];
  requestedLocations: readonly string[];
}): ResolvedCachePerson[] {
  if (input.requestedRoles.length === 0) {
    return [];
  }

  const requestedLocations = new Set(normalizeLocationsForCache([...input.requestedLocations]));

  return input.people.filter((person) => {
    const normalizedTitle = normalizeTitle(person.normalizedTitle ?? person.currentTitle ?? "");
    const category = coercePositionCategory(person.positionCategory);
    const roleMatches = input.requestedRoles.some(
      (role) =>
        (role.category !== "OTHER" && category === role.category) ||
        (Boolean(normalizedTitle) && normalizedTitle === role.normalizedTitle)
    );
    if (!roleMatches) {
      return false;
    }

    if (requestedLocations.size === 0) {
      return true;
    }
    const personLocations = normalizeLocationsForCache(
      [person.location, person.country, person.state, person.city].filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim())
      )
    );
    return personLocations.some((location) => requestedLocations.has(location));
  });
}
