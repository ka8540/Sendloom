import type { ProspectSearch as ProspectSearchRow } from "@prisma/client";
import { ZodError } from "zod";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, requireUser } from "@/graphql/errors";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, mapProspectError } from "@/graphql/resolvers/helpers";
import { getDiscoverQuotaStatus } from "@/lib/discover-quota";
import { createProspectSearchSchema, type CreateProspectSearchInput } from "@/services/prospects/prospect-validation";

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

  async processProspectSearch(_root: unknown, args: { id: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      // The quota email is taken from the authenticated session user only — a
      // request body / GraphQL input email can never grant the exemption.
      return await context.services.prospectSearch.processSearch(user.id, args.id, {
        actorEmail: user.email
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
  peopleCount(parent: ProspectSearchRow) {
    return parent.totalProcessed;
  }
};
