import type { PositionCategory } from "@/lib/prospect-enums";
import { coercePositionCategory } from "@/lib/prospect-enums";
import type { ResolvedCachePerson } from "@/services/prospects/discover-cache-service";
import { evaluateDiscoverLocationMatch } from "@/services/prospects/discover-location-matching";
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
 * uses the best stored structured geography and accepts a requested geography
 * contained in a fuller location string. This runtime decision is separate
 * from exact cache fingerprint semantics.
 */
export function filterReusableDiscoverPeople(input: {
  people: readonly ResolvedCachePerson[];
  requestedRoles: readonly RequestedRoleMatch[];
  requestedLocations: readonly string[];
}): ResolvedCachePerson[] {
  if (input.requestedRoles.length === 0) {
    return [];
  }

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

    return evaluateDiscoverLocationMatch({
      candidate: person,
      requestedLocations: input.requestedLocations,
      context: "CACHE"
    }).matches;
  });
}
