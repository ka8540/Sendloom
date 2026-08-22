import type { Prisma, PrismaClient } from "@prisma/client";

import type { PositionCategory } from "@/lib/prospect-enums";
import {
  normalizeRoleGroupToken,
  normalizeRoleGroupTokens
} from "@/services/prospects/discover-role-group-key";

export type ProspectPeopleFilterScope = {
  userId: string;
  companyId: string;
  positionCategory?: PositionCategory | null;
  location?: string | null;
  search?: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Resolve a location filter to the people allocated to matching searches.
 * This preserves the Discover table's legacy fallback: when matching searches
 * predate durable allocations, their location group owns the whole company.
 */
async function resolveLocationPersonIds(
  prisma: PrismaClient,
  userId: string,
  companyId: string,
  location: string | null | undefined
): Promise<string[] | null> {
  if (location === null || location === undefined) {
    return null;
  }

  const token = normalizeRoleGroupToken(location);
  const searches = await prisma.prospectSearch.findMany({ where: { userId, companyId } });
  const matchingSearches = searches.filter((search) => {
    const tokens = normalizeRoleGroupTokens(stringArray(search.requestedLocations));
    return token === "" ? tokens.length === 0 : tokens.includes(token);
  });

  if (matchingSearches.length === 0) {
    return [];
  }

  const allocations = await prisma.prospectSearchPerson.findMany({
    where: { searchId: { in: matchingSearches.map((search) => search.id) } },
    select: { personId: true }
  });
  if (allocations.length === 0) {
    return null;
  }

  return [...new Set(allocations.map((row) => row.personId))];
}

/**
 * The single source of truth for the People table and ALL_MATCHING actions.
 * Every filter is applied before pagination/export so displayed, counted,
 * reviewed, exported, and imported records always describe the same set.
 */
export async function buildProspectPeopleWhere(
  prisma: PrismaClient,
  scope: ProspectPeopleFilterScope
): Promise<Prisma.ProspectPersonWhereInput> {
  const locationPersonIds = await resolveLocationPersonIds(
    prisma,
    scope.userId,
    scope.companyId,
    scope.location
  );
  const search = scope.search?.trim();

  return {
    userId: scope.userId,
    companyId: scope.companyId,
    ...(scope.positionCategory ? { position: { category: scope.positionCategory } } : {}),
    ...(locationPersonIds !== null ? { id: { in: locationPersonIds } } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { currentTitle: { contains: search, mode: "insensitive" } },
            { normalizedTitle: { contains: search, mode: "insensitive" } },
            { inferredEmail: { contains: search, mode: "insensitive" } },
            { location: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
            { state: { contains: search, mode: "insensitive" } },
            { country: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };
}
