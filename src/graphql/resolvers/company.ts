import type { ProspectCompany, ProspectCompanyPosition } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { coerceConfidenceLevel } from "@/lib/prospect-enums";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, mapProspectError } from "@/graphql/resolvers/helpers";
import { notFoundError, requireUser } from "@/graphql/errors";

type EvidenceRow = { pattern?: unknown; reason?: unknown; sourceName?: unknown; sourceUrl?: unknown; percentage?: unknown };

export const companyQueries = {
  async company(_root: unknown, args: { id: string }, context: GraphQLContext) {
    requireUser(context);
    // The loader is user-scoped, so a company owned by another user resolves to
    // null (no cross-user access).
    return context.loaders.companyById.load(args.id);
  },

  async companies(_root: unknown, args: { first?: number | null; after?: string | null }, context: GraphQLContext) {
    const user = requireUser(context);
    const first = resolveFirst(args.first, 20);
    const afterId = decodeCursor(args.after);

    const [rows, totalCount] = await Promise.all([
      context.prisma.prospectCompany.findMany({ where: { userId: user.id }, ...cursorArgs(first, afterId) }),
      context.prisma.prospectCompany.count({ where: { userId: user.id } })
    ]);

    return buildConnection(rows, first, totalCount);
  }
};

export const companyMutations = {
  async reclassifyCompanyPositions(_root: unknown, args: { companyId: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.reclassifyCompanyPositions(user.id, args.companyId);
    } catch (error) {
      mapProspectError(error);
    }
  },

  async reinferCompanyEmailPattern(_root: unknown, args: { companyId: string }, context: GraphQLContext) {
    const user = requireUser(context);
    try {
      return await context.services.prospectSearch.reinferCompanyEmailPattern(user.id, args.companyId);
    } catch (error) {
      mapProspectError(error);
    }
  }
};

export const Company = {
  positions(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    return context.loaders.positionsByCompanyId.load(parent.id);
  },
  peopleCount(parent: ProspectCompany, _args: unknown, context: GraphQLContext) {
    return context.loaders.peopleCountByCompanyId.load(parent.id);
  },
  domainConfidence(parent: ProspectCompany) {
    return coerceConfidenceLevel(parent.domainConfidence);
  },
  patternConfidence(parent: ProspectCompany) {
    return coerceConfidenceLevel(parent.patternConfidence);
  },
  patternEvidence(parent: ProspectCompany) {
    const evidence = Array.isArray(parent.patternEvidence) ? (parent.patternEvidence as EvidenceRow[]) : [];
    const confidence = coerceConfidenceLevel(parent.patternConfidence);
    return evidence
      .filter((row) => typeof row?.pattern === "string")
      .map((row) => ({
        pattern: String(row.pattern),
        sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
        sourceName: typeof row.sourceName === "string" ? row.sourceName : typeof row.reason === "string" ? row.reason : "inference",
        percentage: typeof row.percentage === "number" ? row.percentage : null,
        confidence
      }));
  }
};

export const CompanyPosition = {
  async company(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    const company = await context.loaders.companyById.load(parent.companyId);
    if (!company) {
      throw notFoundError("Company not found.");
    }
    return company;
  },
  rawTitles(parent: ProspectCompanyPosition) {
    return asStringArray(parent.rawTitles);
  },
  people(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    return context.loaders.peopleByPositionId.load(parent.id);
  },
  peopleCount(parent: ProspectCompanyPosition, _args: unknown, context: GraphQLContext) {
    return context.loaders.peopleCountByPositionId.load(parent.id);
  }
};
