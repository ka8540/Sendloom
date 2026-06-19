import type { ProspectCompany } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import { badInputError, forbiddenError, notFoundError } from "@/graphql/errors";
import { ProspectError } from "@/services/prospects/prospect-search-service";

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Load a company through the user-scoped loader, throwing if it is not owned. */
export async function loadCompanyOrThrow(context: GraphQLContext, companyId: string): Promise<ProspectCompany> {
  const company = await context.loaders.companyById.load(companyId);
  if (!company) {
    throw notFoundError("Company not found.");
  }
  return company;
}

/** Translate a service-level ProspectError into the right GraphQL error code. */
export function mapProspectError(error: unknown): never {
  if (error instanceof ProspectError) {
    switch (error.code) {
      case "NOT_FOUND":
        throw notFoundError(error.message);
      case "INVALID_STATE":
        throw badInputError(error.message);
      case "NOT_CONFIGURED":
      case "RATE_LIMITED":
        throw forbiddenError(error.message);
      default:
        break;
    }
  }
  throw error;
}
