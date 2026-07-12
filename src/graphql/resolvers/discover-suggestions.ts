import type { ProspectSearch } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, requireUser } from "@/graphql/errors";
import {
  buildDiscoverSuggestions,
  type DiscoverSuggestionType,
  type SuggestionCompanyRow
} from "@/services/prospects/discover-suggestion-source";
import { DEFAULT_SUGGESTION_LIMIT, type RankedSuggestion } from "@/services/prospects/discover-suggestions";

const ALL_TYPES: DiscoverSuggestionType[] = ["COMPANY", "ROLE", "LOCATION"];
// Guards against a pathological query string being used as an expensive edit
// target; real company/role/location inputs are far shorter than this.
const MAX_QUERY_LENGTH = 200;
// Company suggestions rank in memory over the global identity pool so fuzzy /
// punctuation-tolerant matching and typo correction keep working (a SQL
// `contains` prefilter would kill both). The pool is capped at the most
// recently updated rows per source as a safety valve; Discover's fixed daily
// search quota keeps these tables far below the cap in practice.
const GLOBAL_COMPANY_CANDIDATE_LIMIT = 1000;

export const discoverSuggestionQueries = {
  /**
   * Autocomplete + conservative typo correction for the Discover inputs.
   *
   * COMPANY suggestions are GLOBAL: they search Sendloom's company identity
   * records (every user's resolved ProspectCompany rows plus the shared
   * Discover cache), so a company any user has resolved before autocompletes
   * for everyone. Only reusable identity fields are fetched and returned —
   * name, domain, canonical key — never people, emails, usage counts, or who
   * searched what; a row id is exposed only for the current user's own rows.
   *
   * ROLE / LOCATION suggestions remain owner-scoped: only `where: { userId }`
   * searches are read, so one user never sees another's role/location history.
   *
   * No provider, Apify, or AI is called. An empty query returns empty lists
   * (never an error); `types` narrows which lists are computed; `companyId`
   * prioritizes that company's roles/locations for the inside-company card.
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

    const wantsCompanies = types.includes("COMPANY");

    // Companies: global fetch, but SELECT only safe identity columns — no
    // people, emails, evidence, or requester linkage ever leaves the database
    // layer. Searches: owner-scoped, exactly like discoverCompanyGroups. A
    // `companyId` arg is only ever used to prioritize the current company's
    // labels — it is matched against this user's own searches, never trusted
    // to read another user's data.
    const [companyRows, cacheRows, searches] = await Promise.all([
      wantsCompanies
        ? context.prisma.prospectCompany.findMany({
            select: {
              id: true,
              userId: true,
              name: true,
              officialName: true,
              normalizedName: true,
              canonicalKey: true,
              officialDomain: true,
              officialWebsiteDomain: true,
              emailDomain: true,
              linkedinUrl: true
            },
            orderBy: { updatedAt: "desc" },
            take: GLOBAL_COMPANY_CANDIDATE_LIMIT
          })
        : Promise.resolve([]),
      wantsCompanies
        ? context.prisma.discoverSearchCache.findMany({
            select: {
              id: true,
              companyKey: true,
              companyName: true,
              companyDomain: true,
              companyLinkedinUrl: true
            },
            orderBy: { updatedAt: "desc" },
            take: GLOBAL_COMPANY_CANDIDATE_LIMIT
          })
        : Promise.resolve([]),
      context.prisma.prospectSearch.findMany({ where: { userId: user.id } })
    ]);

    // Re-shape into identity-only candidate rows. `userId` is consumed HERE to
    // flag the user's own rows (only those may expose a row id) and never
    // travels further; cache entries are identity-only by construction.
    const companies: SuggestionCompanyRow[] = [
      ...companyRows.map((row) => ({
        id: row.id,
        name: row.name,
        officialName: row.officialName,
        normalizedName: row.normalizedName,
        canonicalKey: row.canonicalKey,
        officialDomain: row.officialDomain,
        officialWebsiteDomain: row.officialWebsiteDomain,
        emailDomain: row.emailDomain,
        linkedinUrl: row.linkedinUrl,
        isOwn: row.userId === user.id
      })),
      ...cacheRows.map((entry) => ({
        id: `cache:${entry.id}`,
        name: entry.companyName,
        canonicalKey: entry.companyKey,
        officialDomain: entry.companyDomain,
        linkedinUrl: entry.companyLinkedinUrl,
        isOwn: false
      }))
    ];

    return buildDiscoverSuggestions({
      query,
      types,
      companyId: args.companyId ?? null,
      companies,
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
