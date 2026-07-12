import type { ProspectPerson as ProspectPersonRow } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { notFoundError, requireUser } from "@/graphql/errors";
import { env } from "@/lib/env";
import { isPositionCategory, overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { buildConnection, cursorArgs, decodeCursor, resolveFirst } from "@/graphql/pagination";
import { asStringArray, loadCompanyOrThrow } from "@/graphql/resolvers/helpers";
import {
  normalizeRoleGroupToken,
  normalizeRoleGroupTokens
} from "@/services/prospects/discover-role-group-key";
import { resolveProspectPersonEmail } from "@/services/prospects/prospect-person-email";

/**
 * Resolve a location filter to a person-id restriction for one company.
 * Membership follows the per-search allocations: a person belongs to a
 * location group when one of the USER'S searches whose normalized requested
 * location matches the filter has allocated that person. `location` uses the
 * same conservative fold as the role-group identity, so "united  states"
 * matches "United States" but never "Canada"; "" targets the searches run
 * WITHOUT a location.
 *
 * Returns null for "no restriction": either no filter was requested, or every
 * matched search predates allocations (legacy searches own the whole company,
 * the same fallback the group people-count uses).
 */
async function resolveLocationPersonIds(
  context: GraphQLContext,
  userId: string,
  companyId: string,
  location: string | null | undefined
): Promise<string[] | null> {
  if (location === null || location === undefined) {
    return null;
  }
  const token = normalizeRoleGroupToken(location);
  const searches = await context.prisma.prospectSearch.findMany({ where: { userId, companyId } });
  const matching = searches.filter((search) => {
    const tokens = normalizeRoleGroupTokens(asStringArray(search.requestedLocations));
    return token === "" ? tokens.length === 0 : tokens.includes(token);
  });
  if (matching.length === 0) {
    return [];
  }
  const allocations = await context.prisma.prospectSearchPerson.findMany({
    where: { searchId: { in: matching.map((search) => search.id) } },
    select: { personId: true }
  });
  if (allocations.length === 0) {
    return null;
  }
  return [...new Set(allocations.map((row) => row.personId))];
}

export const personQueries = {
  async people(
    _root: unknown,
    args: {
      companyId: string;
      positionCategory?: string | null;
      location?: string | null;
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
    const locationPersonIds = await resolveLocationPersonIds(context, user.id, args.companyId, args.location);

    const where = {
      userId: user.id,
      companyId: args.companyId,
      ...(args.positionCategory && isPositionCategory(args.positionCategory)
        ? { position: { category: args.positionCategory } }
        : {}),
      ...(locationPersonIds !== null ? { id: { in: locationPersonIds } } : {})
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
