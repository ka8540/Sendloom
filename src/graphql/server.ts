import { createSchema, createYoga } from "graphql-yoga";

import { buildGraphQLContext, type GraphQLContext } from "@/graphql/context";
import { resolvers } from "@/graphql/resolvers";
import { typeDefs } from "@/graphql/schema";
import { useProspectSecurity } from "@/graphql/security";

export const GRAPHQL_ENDPOINT = "/api/graphql";

/**
 * GraphiQL is only enabled outside production AND when explicitly opted in.
 * Exported so the production-disabled guarantee is directly unit-testable.
 */
export function resolveGraphiqlEnabled(nodeEnv: string | undefined, flagEnabled: boolean): boolean {
  return nodeEnv !== "production" && flagEnabled;
}

// The executable schema is exported so resolver/security tests can run against
// it directly with graphql() without standing up the HTTP server.
export const prospectSchema = createSchema({ typeDefs, resolvers });

export type CreateProspectYogaOptions = {
  graphiql?: Parameters<typeof createYoga>[0]["graphiql"];
  disableIntrospection?: boolean;
  context?: () => Promise<GraphQLContext> | GraphQLContext;
};

export function createProspectYoga(options: CreateProspectYogaOptions = {}) {
  return createYoga({
    schema: prospectSchema,
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    context: options.context ?? (() => buildGraphQLContext()),
    graphiql: options.graphiql ?? false,
    landingPage: false,
    plugins: [useProspectSecurity({ disableIntrospection: options.disableIntrospection ?? false })],
    fetchAPI: { Response }
  });
}
