import type { ProspectCompany, ProspectSearch } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, requireUser } from "@/graphql/errors";
import {
  buildDiscoverSuggestions,
  type DiscoverSuggestionType
} from "@/services/prospects/discover-suggestion-source";
import { DEFAULT_SUGGESTION_LIMIT, type RankedSuggestion } from "@/services/prospects/discover-suggestions";

const ALL_TYPES: DiscoverSuggestionType[] = ["COMPANY", "ROLE", "LOCATION"];
// Guards against a pathological query string being used as an expensive edit
// target; real company/role/location inputs are far shorter than this.
const MAX_QUERY_LENGTH = 200;

export const discoverSuggestionQueries = {
  /**
   * Autocomplete + conservative typo correction over the authenticated user's
   * OWN Discover data. Owner-scoped end to end: only `where: { userId }` rows are
   * ever read, so one user can never see another's companies/roles/locations. No
   * provider, Apify, or AI is called — every suggestion is a value the user has
   * already used. An empty query returns empty lists (never an error); `types`
   * narrows which lists are computed; `companyId` prioritizes that company's
   * roles/locations for the inside-company card.
   */
  async discoverSuggestions(
    _root: unknown,
    args: { query: string; types?: DiscoverSuggestionType[] | null; companyId?: string | null },
    context: GraphQLContext
  ) {
    const user = requireUser(context);

    const query = (args.query ?? "").trim();
    if (query.length > MAX_QUERY_LENGTH) {
      throw badInputError("Search query is too long.");
    }

    const types = args.types && args.types.length > 0 ? [...new Set(args.types)] : ALL_TYPES;
    const empty = { companies: [], roles: [], locations: [] };
    if (!query) {
      return empty;
    }

    // Owner-scoped fetch: identical to how discoverCompanyGroups reads the user's
    // rows. A `companyId` is only ever used to prioritize the current company's
    // labels — it is filtered against this user's own searches, never trusted to
    // read another user's data.
    const [companies, searches] = await Promise.all([
      context.prisma.prospectCompany.findMany({ where: { userId: user.id } }),
      context.prisma.prospectSearch.findMany({ where: { userId: user.id } })
    ]);

    return buildDiscoverSuggestions({
      query,
      types,
      companyId: args.companyId ?? null,
      companies: companies as ProspectCompany[],
      searches: searches as ProspectSearch[],
      limit: DEFAULT_SUGGESTION_LIMIT
    });
  }
};

// The pure ranker uses lowercase kinds ("match"/"correction") for ergonomic TS;
// map them to the GraphQL enum at the boundary.
export const DiscoverSuggestion = {
  kind(parent: RankedSuggestion) {
    return parent.kind === "correction" ? "CORRECTION" : "MATCH";
  }
};
