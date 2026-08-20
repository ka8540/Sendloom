import type { ProspectSearch as ProspectSearchRow } from "@prisma/client";
import { ZodError } from "zod";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, requireUser } from "@/graphql/errors";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, mapProspectError } from "@/graphql/resolvers/helpers";
import { discoverPublicErrorCategory, mapDiscoverPublicError } from "@/lib/discover-public-error";
import { getDiscoverQuotaStatus } from "@/lib/discover-quota";
import { coercePositionCategory } from "@/lib/prospect-enums";
import { COMMON_LOCATION_LABELS, COMMON_ROLE_LABELS } from "@/services/prospects/discover-canonical-labels";
import {
  buildDiscoverCompanyGroups,
  type DiscoverCompanyGroupNode
} from "@/services/prospects/discover-company-groups";
import { validateCompanyRoleSearchInput } from "@/services/prospects/discover-company-role-search";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
import {
  buildTrustedDiscoverLabelPool,
  validateDiscoverSearchLabels
} from "@/services/prospects/discover-search-label-validation";
import { createProspectSearchSchema, type CreateProspectSearchInput } from "@/services/prospects/prospect-validation";

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export const prospectSearchQueries = {
  /**
   * Authenticated Discover quota status. The exemption decision and counter are
   * resolved entirely from the session user — never from request input — so the
   * `unlimited` flag here is presentation-only and cannot be spoofed.
   */
  async discoverQuota(_root: unknown, _args: unknown, context: GraphQLContext) {
    const user = requireUser(context);
    return getDiscoverQuotaStatus(user.id, user.email);
  },

  async prospectSearch(_root: unknown, args: { id: string }, context: GraphQLContext) {
    const user = requireUser(context);
    return context.prisma.prospectSearch.findFirst({ where: { id: args.id, userId: user.id } });
  },

  async prospectSearches(_root: unknown, args: { first?: number | null; after?: string | null }, context: GraphQLContext) {
    const user = requireUser(context);
    const first = resolveFirst(args.first, 20);
    const afterId = decodeCursor(args.after);

    const [rows, totalCount] = await Promise.all([
      context.prisma.prospectSearch.findMany({ where: { userId: user.id }, ...cursorArgs(first, afterId) }),
      context.prisma.prospectSearch.count({ where: { userId: user.id } })
    ]);

    return buildConnection(rows, first, totalCount);
  },

  /**
   * Grouped Search History: the current user's searches consolidated into one
   * entry per resolved company (display-only — child search records, usage
   * events, and allocations are untouched). Pagination operates on GROUPS, so
   * three Walmart role searches count as one entry. Owner-scoped: only the
   * session user's searches are ever read.
   */
  async discoverCompanyGroups(
    _root: unknown,
    args: { first?: number | null; after?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    const first = resolveFirst(args.first, 20);
    const afterId = decodeCursor(args.after);

    const rows = await context.prisma.prospectSearch.findMany({ where: { userId: user.id } });
    const groups = buildDiscoverCompanyGroups(user.id, rows as ProspectSearchRow[]);

    const start = afterId ? groups.findIndex((group) => group.id === afterId) + 1 : 0;
    if (afterId && start === 0) {
      throw badInputError("Invalid pagination cursor.");
    }
    return buildConnection(groups.slice(start, start + first + 1), first, groups.length);
  }
};

type DiscoverCompanyGroupParent = DiscoverCompanyGroupNode<ProspectSearchRow>;

export const DiscoverCompanyGroup = {
  company(parent: DiscoverCompanyGroupParent, _args: unknown, context: GraphQLContext) {
    // The loader is user-scoped, so a group can never hydrate another user's
    // company row.
    return parent.companyId ? context.loaders.companyById.load(parent.companyId) : null;
  },
  /**
   * The UNIQUE union of people allocated to this user across the group's
   * searches — a person granted by two role searches counts once, and shared
   * cached candidates that were never allocated are invisible here. A fully
   * legacy group without allocation rows falls back to the user's materialized
   * company people (its exact pre-allocation count).
   */
  async peopleCount(parent: DiscoverCompanyGroupParent, _args: unknown, context: GraphQLContext) {
    const allocations = await context.prisma.prospectSearchPerson.findMany({
      where: { searchId: { in: parent.searches.map((search) => search.id) } },
      select: { personId: true }
    });
    if (allocations.length > 0) {
      return new Set(allocations.map((row) => row.personId)).size;
    }
    if (parent.companyId) {
      return context.prisma.prospectPerson.count({
        where: { userId: parent.userId, companyId: parent.companyId }
      });
    }
    return parent.searches.reduce((sum, search) => sum + (search.totalProcessed ?? 0), 0);
  }
};

/**
 * The user's own role + location labels across their searches — the trusted
 * pool a typo is allowed to snap onto (alongside the small generic dictionary).
 * Owner-scoped: only this user's rows are read, so canonicalization can never
 * pull in another user's values.
 */
async function loadKnownLabels(context: GraphQLContext, userId: string) {
  const rows = await context.prisma.prospectSearch.findMany({ where: { userId } });
  const roles = new Set<string>();
  const locations = new Set<string>();
  for (const row of rows) {
    for (const title of asStringArray(row.requestedTitles)) {
      roles.add(title);
    }
    for (const location of asStringArray(row.requestedLocations)) {
      locations.add(location);
    }
  }
  return {
    roles: buildTrustedDiscoverLabelPool("ROLE", [...roles, ...COMMON_ROLE_LABELS]),
    locations: buildTrustedDiscoverLabelPool("LOCATION", [...locations, ...COMMON_LOCATION_LABELS])
  };
}

export const prospectSearchMutations = {
  async createProspectSearch(_root: unknown, args: { input: CreateProspectSearchInput }, context: GraphQLContext) {
    const user = requireUser(context);
    let validated;
    try {
      validated = createProspectSearchSchema.parse(args.input);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badInputError(error.issues[0]?.message ?? "Invalid input.");
      }
      throw error;
    }
    // Owner-scoped historical values are untrusted until sanitized by the same
    // validation boundary. Reject the whole request if any token is incomplete
    // or ambiguous; only final canonical values can reach createSearch.
    const known = await loadKnownLabels(context, user.id);
    const roles = validateDiscoverSearchLabels({
      type: "ROLE",
      values: validated.jobTitles,
      knownValues: known.roles
    });
    if (!roles.ok) {
      throw badInputError(roles.message);
    }
    const locations = validateDiscoverSearchLabels({
      type: "LOCATION",
      values: validated.locations,
      knownValues: known.locations
    });
    if (!locations.ok) {
      throw badInputError(locations.message);
    }
    const normalized = {
      ...validated,
      jobTitles: roles.values,
      locations: locations.values
    };
    return context.services.prospectSearch.createSearch(user.id, normalized);
  },

  async processProspectSearch(
    _root: unknown,
    args: { id: string; idempotencyKey?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    try {
      // The quota email is taken from the authenticated session user only — a
      // request body / GraphQL input email can never grant the exemption.
      return await context.services.prospectSearch.processSearch(user.id, args.id, {
        actorEmail: user.email,
        idempotencyKey: args.idempotencyKey ?? null
      });
    } catch (error) {
      mapProspectError(error);
    }
  },

  async cancelProspectSearch(_root: unknown, args: { id: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.cancelSearch(user.id, args.id);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async deleteProspectSearch(_root: unknown, args: { id: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      // Ownership is enforced server-side from the session user — the client id is
      // never trusted on its own.
      return await context.services.prospectSearch.deleteSearch(user.id, args.id);
    } catch (error) {
      mapProspectError(error);
    }
  },

  /**
   * "Search this company" from the company detail page. Ownership is enforced
   * server-side from the session user, and an exact normalized role+location
   * duplicate throws DUPLICATE_ROLE_LOCATION before any quota or provider work
   * — see ProspectSearchService.searchCompanyRole.
   */
  async searchCompanyRole(
    _root: unknown,
    args: { companyId: string; jobTitle: string; location?: string | null; idempotencyKey?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    const idempotencyKey = (args.idempotencyKey ?? "").trim();
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw badInputError("A valid idempotency key is required.");
    }
    // Validate/canonicalize before duplicate identity, persistence, quota, or
    // provider work. The service repeats this pure gate so direct service calls
    // cannot bypass it.
    const known = await loadKnownLabels(context, user.id);
    const validated = validateCompanyRoleSearchInput({
      jobTitle: args.jobTitle,
      location: args.location,
      knownRoles: known.roles,
      knownLocations: known.locations
    });
    if (!validated.ok) {
      throw badInputError(validated.message);
    }
    try {
      // The quota email is taken from the authenticated session user only — a
      // request body / GraphQL input can never grant the exemption.
      return await context.services.prospectSearch.searchCompanyRole(user.id, {
        companyId: args.companyId,
        jobTitle: validated.jobTitle,
        location: validated.location,
        actorEmail: user.email,
        idempotencyKey: idempotencyKey || null
      });
    } catch (error) {
      mapProspectError(error);
    }
  },

  async addMoreDiscoverPeople(
    _root: unknown,
    args: { searchId: string; idempotencyKey: string },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    const idempotencyKey = (args.idempotencyKey ?? "").trim();
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw badInputError("A valid idempotency key is required.");
    }
    try {
      // The quota email is taken from the authenticated session user only — a
      // request body / GraphQL input can never grant the exemption.
      return await context.services.discoverExpansion.addMorePeople({
        userId: user.id,
        actorEmail: user.email,
        searchId: args.searchId,
        idempotencyKey
      });
    } catch (error) {
      mapProspectError(error);
    }
  }
};

export const ProspectSearch = {
  company(parent: ProspectSearchRow, _args: unknown, context: GraphQLContext) {
    return parent.companyId ? context.loaders.companyById.load(parent.companyId) : null;
  },
  requestedTitles(parent: ProspectSearchRow) {
    return asStringArray(parent.requestedTitles);
  },
  requestedLocations(parent: ProspectSearchRow) {
    return asStringArray(parent.requestedLocations);
  },
  // Failure surface is sanitized at the boundary: the stored raw internal code
  // (e.g. COMPANY_UNRESOLVED, PROVIDER_TIMEOUT) is mapped to a safe product
  // category + copy here and NEVER returned verbatim. A non-FAILED search exposes
  // no error at all.
  errorCode(parent: ProspectSearchRow) {
    return parent.status === "FAILED" ? discoverPublicErrorCategory(parent.errorCode) : null;
  },
  errorTitle(parent: ProspectSearchRow) {
    return parent.status === "FAILED" ? mapDiscoverPublicError(parent.errorCode).title : null;
  },
  errorMessage(parent: ProspectSearchRow) {
    return parent.status === "FAILED" ? mapDiscoverPublicError(parent.errorCode).message : null;
  },
  retryable(parent: ProspectSearchRow) {
    return parent.status === "FAILED" ? mapDiscoverPublicError(parent.errorCode).retryable : false;
  },
  async peopleCount(parent: ProspectSearchRow, _args: unknown, context: GraphQLContext) {
    const durableAllocationCount = await context.prisma.prospectSearchPerson.count({ where: { searchId: parent.id } });
    // Allocation-backed searches resolve from grants, not a potentially stale
    // row loaded before an expansion completed. Preserve the pre-allocation
    // fallback for legacy searches with no grants at all.
    return durableAllocationCount > 0 ? durableAllocationCount : parent.totalProcessed;
  },
  /**
   * Distinct role-group categories among the people ALLOCATED to this search
   * (never the shared cache), sorted for determinism. A legacy pre-allocation
   * search falls back to the user's materialized company people. Drives the
   * grouped detail page's role-targeted "Add 10 more".
   */
  async positionCategories(parent: ProspectSearchRow, _args: unknown, context: GraphQLContext) {
    const user = requireUser(context);
    const allocations = await context.prisma.prospectSearchPerson.findMany({
      where: { searchId: parent.id },
      select: { personId: true }
    });
    let people: Array<{ positionId: string }>;
    if (allocations.length > 0) {
      people = await context.prisma.prospectPerson.findMany({
        where: { userId: user.id, id: { in: allocations.map((row) => row.personId) } },
        select: { positionId: true }
      });
    } else if (parent.companyId) {
      people = await context.prisma.prospectPerson.findMany({
        where: { userId: user.id, companyId: parent.companyId },
        select: { positionId: true }
      });
    } else {
      return [];
    }
    if (people.length === 0) {
      return [];
    }
    const positions = await context.prisma.prospectCompanyPosition.findMany({
      where: { id: { in: [...new Set(people.map((person) => person.positionId))] } }
    });
    return [...new Set(positions.map((position) => coercePositionCategory(position.category)))].sort();
  },
  /**
   * Whether no more unique people can be added to this search. True only when the
   * shared provider results for this canonical query are exhausted AND this
   * search's own allocation already contains every cached person — so "Add 10
   * more" should be hidden. Cheap in the common case (one indexed cache lookup
   * that short-circuits to false). A legacy pre-allocation search (no grants)
   * falls back to the user's company-scoped people, its pre-allocation behavior.
   */
  async exhausted(parent: ProspectSearchRow, _args: unknown, context: GraphQLContext) {
    const user = requireUser(context);
    if (parent.status !== "READY" || !parent.cacheFingerprint || !parent.companyId) {
      return false;
    }
    const cache = await context.prisma.discoverSearchCache.findUnique({
      where: { fingerprint: parent.cacheFingerprint }
    });
    if (!cache || !cache.providerExhausted) {
      return false;
    }
    const cachePeople = await context.prisma.discoverSearchCachePerson.findMany({
      where: { cacheId: cache.id },
      select: { sourceProfileId: true, linkedinUrl: true }
    });
    if (cachePeople.length === 0) {
      return false;
    }
    const allocations = await context.prisma.prospectSearchPerson.findMany({
      where: { searchId: parent.id },
      select: { personId: true }
    });
    const userPeople = await context.prisma.prospectPerson.findMany({
      where:
        allocations.length > 0
          ? { userId: user.id, id: { in: allocations.map((row) => row.personId) } }
          : { userId: user.id, companyId: parent.companyId },
      select: { sourceProfileId: true, linkedinUrl: true }
    });
    const known = new PersonIdentitySet(userPeople);
    return cachePeople.every((person) => known.has(person));
  }
};
