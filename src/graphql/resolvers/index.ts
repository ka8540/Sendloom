import { Company, CompanyPosition, companyMutations, companyQueries } from "@/graphql/resolvers/company";
import { DiscoverSuggestion, discoverSuggestionQueries } from "@/graphql/resolvers/discover-suggestions";
import { ProspectPerson, personQueries } from "@/graphql/resolvers/person";
import { prospectExportMutations } from "@/graphql/resolvers/prospect-export";
import {
  DiscoverCompanyGroup,
  ProspectSearch,
  prospectSearchMutations,
  prospectSearchQueries
} from "@/graphql/resolvers/prospect-search";
import { DateTimeScalar } from "@/graphql/resolvers/scalars";

export const resolvers = {
  DateTime: DateTimeScalar,
  Query: {
    ...prospectSearchQueries,
    ...discoverSuggestionQueries,
    ...companyQueries,
    ...personQueries
  },
  Mutation: {
    ...prospectSearchMutations,
    ...companyMutations,
    ...prospectExportMutations
  },
  Company,
  CompanyPosition,
  DiscoverCompanyGroup,
  DiscoverSuggestion,
  ProspectPerson,
  ProspectSearch
};
