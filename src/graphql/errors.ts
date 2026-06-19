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
 * The daily Discover usage quota is exhausted. The message is already
 * user-safe (it carries only the limit and reset time, never internal counters,
 * keys, or user ids); the code lets the client render a clean product state.
 */
export function discoverDailyLimitError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "DISCOVER_DAILY_LIMIT_REACHED" } });
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
