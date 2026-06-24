import type { ProspectCompany } from "@prisma/client";

import type { GraphQLContext } from "@/graphql/context";
import {
  badInputError,
  discoverDailyLimitError,
  discoverExpansionFailedError,
  discoverExpansionRunningError,
  forbiddenError,
  internalError,
  notFoundError
} from "@/graphql/errors";
import { isDatabaseError, logDatabaseError } from "@/lib/db-error";
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
      case "DISCOVER_DAILY_LIMIT_REACHED":
        throw discoverDailyLimitError(error.message);
      case "DISCOVER_EXPANSION_ALREADY_RUNNING":
        throw discoverExpansionRunningError(error.message);
      case "DISCOVER_EXPANSION_FAILED":
        throw discoverExpansionFailedError(error.message);
      default:
        break;
    }
  }
  // Raw database errors must never reach the client (they carry table/column/SQL
  // internals). Yoga also masks unexpected errors, but this makes the guarantee
  // explicit and independent of that configuration.
  if (isDatabaseError(error)) {
    logDatabaseError(error, { operation: "graphql.resolver" });
    throw internalError();
  }
  throw error;
}
