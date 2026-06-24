import { GraphQLError } from "graphql";

import type { GraphQLContext } from "@/graphql/context";

export function unauthenticatedError(message = "Authentication required."): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "UNAUTHENTICATED" } });
}

export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

export function notFoundError(message = "Not found."): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function badInputError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

/**
 * A generic, user-safe server error. Used to sanitize unexpected failures (most
 * importantly raw database/Prisma errors) so SQL, table, and column internals
 * never reach the client — independent of the Yoga error-masking default.
 */
export function internalError(message = "Something went wrong. Please try again."): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
}

/**
 * The daily Discover usage quota is exhausted. The message is already
 * user-safe (it carries only the limit and reset time, never internal counters,
 * keys, or user ids); the code lets the client render a clean product state.
 */
export function discoverDailyLimitError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "DISCOVER_DAILY_LIMIT_REACHED" } });
}

/** Another "Add 10 more" is already running for this search. */
export function discoverExpansionRunningError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "DISCOVER_EXPANSION_ALREADY_RUNNING" } });
}

/** An "Add 10 more" expansion failed; existing people are preserved and it can be retried. */
export function discoverExpansionFailedError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "DISCOVER_EXPANSION_FAILED" } });
}

/**
 * Resolve the authenticated, eligible user for a request or throw. Every
 * prospect resolver must call this before touching data — there is no weaker
 * GraphQL-only auth path.
 */
export function requireUser(context: GraphQLContext) {
  if (context.authError) {
    throw forbiddenError(context.authError);
  }
  if (!context.user) {
    throw unauthenticatedError();
  }
  return context.user;
}
