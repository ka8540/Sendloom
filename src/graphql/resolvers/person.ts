import type { ProspectPerson as ProspectPersonRow } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { notFoundError, requireUser } from "@/graphql/errors";
import { isPositionCategory } from "@/lib/prospect-enums";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { loadCompanyOrThrow } from "@/graphql/resolvers/helpers";

export const personQueries = {
  async people(
    _root: unknown,
    args: { companyId: string; positionCategory?: string | null; first?: number | null; after?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    // Ownership check — throws if the company is not the caller's.
    await loadCompanyOrThrow(context, args.companyId);

    const first = resolveFirst(args.first, 50);
    const afterId = decodeCursor(args.after);

    const where = {
      userId: user.id,
      companyId: args.companyId,
      ...(args.positionCategory && isPositionCategory(args.positionCategory)
        ? { position: { category: args.positionCategory } }
        : {})
    };

    const [rows, totalCount] = await Promise.all([
      context.prisma.prospectPerson.findMany({ where, ...cursorArgs(first, afterId) }),
      context.prisma.prospectPerson.count({ where })
    ]);

    return buildConnection(rows, first, totalCount);
  }
};

export const ProspectPerson = {
  async company(parent: ProspectPersonRow, _args: unknown, context: GraphQLContext) {
    const company = await context.loaders.companyById.load(parent.companyId);
    if (!company) {
      throw notFoundError("Company not found.");
    }
    return company;
  },
  async position(parent: ProspectPersonRow, _args: unknown, context: GraphQLContext) {
    const position = await context.loaders.positionById.load(parent.positionId);
    if (!position) {
      throw notFoundError("Position not found.");
    }
    return position;
  }
};
