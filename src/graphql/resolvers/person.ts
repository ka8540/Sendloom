import { normalizeDiscoverPersonNames } from "@/services/prospects/discover-person-name-normalization";
import type { ProspectPerson as ProspectPersonRow } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { notFoundError, requireUser } from "@/graphql/errors";
import { env } from "@/lib/env";
import { isPositionCategory, overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { loadCompanyOrThrow } from "@/graphql/resolvers/helpers";
import { buildProspectPeopleWhere } from "@/services/prospects/prospect-people-filter";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";

export const personQueries = {
  async people(
    _root: unknown,
    args: {
      companyId: string;
      positionCategory?: string | null;
      location?: string | null;
      search?: string | null;
      first?: number | null;
      after?: string | null;
    },
    context: GraphQLContext
  ) {
    const user = requireUser(context);
    // Ownership check — throws if the company is not the caller's.
    const company = await loadCompanyOrThrow(context, args.companyId);

    const first = resolveFirst(args.first, 50);
    const afterId = decodeCursor(args.after);
    const where = await buildProspectPeopleWhere(context.prisma, {
      userId: user.id,
      companyId: args.companyId,
      positionCategory:
        args.positionCategory && isPositionCategory(args.positionCategory) ? args.positionCategory : null,
      location: args.location,
      search: args.search
    });

    const [rows, totalCount] = await Promise.all([
      context.prisma.prospectPerson.findMany({ where, ...cursorArgs(first, afterId) }),
      context.prisma.prospectPerson.count({ where })
    ]);

    // Addresses always follow the company's CURRENT format; the suppression
    // state of whatever address a row used to hold never pins it to that
    // address. ProspectPerson.emailStatus then overlays the suppression list
    // onto the address actually being shown.
    const canonicalRows = await normalizeDiscoverPersonNames(rows);
    const derivedRows = canonicalRows.map((person) => ({
      ...person,
      ...resolveProspectPersonEmail(person, company, {
        allowLowConfidence: env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS
      })
    }));

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
