import type { ProspectSearch as ProspectSearchRow } from "@prisma/client";
import { ZodError } from "zod";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, requireUser } from "@/graphql/errors";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, mapProspectError } from "@/graphql/resolvers/helpers";
import { discoverPublicErrorCategory, mapDiscoverPublicError } from "@/lib/discover-public-error";
import { getDiscoverQuotaStatus } from "@/lib/discover-quota";
import { PersonIdentitySet } from "@/services/prospects/discover-person-identity";
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
  }
};

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
    return context.services.prospectSearch.createSearch(user.id, validated);
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
  peopleCount(parent: ProspectSearchRow) {
    return parent.totalProcessed;
  },
  /**
   * Whether no more unique people can be added to this search. True only when the
   * shared provider results for this canonical query are exhausted AND the user
   * already has every cached person — so "Add 10 more" should be hidden. Cheap in
   * the common case (one indexed cache lookup that short-circuits to false).
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
    const userPeople = await context.prisma.prospectPerson.findMany({
      where: { userId: user.id, companyId: parent.companyId },
      select: { sourceProfileId: true, linkedinUrl: true }
    });
    const known = new PersonIdentitySet(userPeople);
    return cachePeople.every((person) => known.has(person));
  }
};
