import { Company, CompanyPosition, companyMutations, companyQueries } from "@/graphql/resolvers/company";
import { ProspectPerson, personQueries } from "@/graphql/resolvers/person";
import { prospectExportMutations } from "@/graphql/resolvers/prospect-export";
import { ProspectSearch, prospectSearchMutations, prospectSearchQueries } from "@/graphql/resolvers/prospect-search";
import { DateTimeScalar } from "@/graphql/resolvers/scalars";

export const resolvers = {
  DateTime: DateTimeScalar,
  Query: {
    ...prospectSearchQueries,
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
  ProspectPerson,
  ProspectSearch
};
