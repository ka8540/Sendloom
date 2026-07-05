import type { ProspectPerson as ProspectPersonRow } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { notFoundError, requireUser } from "@/graphql/errors";
import { env } from "@/lib/env";
import { isPositionCategory, overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { loadCompanyOrThrow } from "@/graphql/resolvers/helpers";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";

export const personQueries = {
  async people(
    _root: unknown,
    args: { companyId: string; positionCategory?: string | null; first?: number | null; after?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    // Ownership check — throws if the company is not the caller's.
    const company = await loadCompanyOrThrow(context, args.companyId);

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

    const derivedRows = await Promise.all(
      rows.map(async (person) => {
        const suppressionReason = person.inferredEmail
          ? await context.loaders.suppressionReasonByEmail.load(person.inferredEmail.trim().toLowerCase())
          : null;
        return {
          ...person,
          ...resolveProspectPersonEmail(person, company, {
            allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS,
            suppressed: Boolean(suppressionReason)
          })
        };
      })
    );

    return buildConnection(derivedRows, first, totalCount);
  }
};

export const ProspectPerson = {
  /**
   * Live-overlaid email status: an address on the user's suppression list
   * reads as FAILED / UNSUBSCRIBED / SUPPRESSED regardless of what generation
   * stored — so a refreshed email pattern or "Add 10 more" can never resurrect
   * a permanently failed address as usable. Same precedence as the company
   * emailStatusCounts resolver, so the summary and the table always agree.
   */
  async emailStatus(parent: ProspectPersonRow, _args: unknown, context: GraphQLContext) {
    if (!parent.inferredEmail) {
      return overlayEmailCandidateStatus(parent.emailStatus, null);
    }
    const reason = await context.loaders.suppressionReasonByEmail.load(parent.inferredEmail.trim().toLowerCase());
    return overlayEmailCandidateStatus(parent.emailStatus, reason);
  },
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
