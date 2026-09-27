import { randomUUID } from "node:crypto";
import { after } from "next/server";

import type { User } from "@prisma/client";

import { getApiRestrictionMessage, getVerificationBlockMessage } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLoaders, type ProspectLoaders } from "@/graphql/loaders";
import { createProspectServices, type ProspectServices } from "@/services/prospects/prospect-services";
import type { AiClient } from "@/services/prospects/prospect-ai";

export interface GraphQLContext {
  /** The authenticated, eligible Sendloom user, or null when not signed in. */
  user: User | null;
  /** A FORBIDDEN message when a signed-in user is restricted/unverified. */
  authError: string | null;
  requestId: string;
  prisma: typeof prisma;
  services: ProspectServices;
  loaders: ProspectLoaders;
  /** Registers request-independent work with the host runtime. */
  defer?: (task: () => Promise<void>) => void;
}

export type BuildContextOptions = {
  /** Allows tests to inject a fully-resolved user and/or mock AI client. */
  userOverride?: User | null;
  aiClient?: AiClient;
  /** Injectable in tests; production uses Next.js after(). */
  defer?: (task: () => Promise<void>) => void;
};

/**
 * Build the per-request GraphQL context. Authentication reuses the same session
 * guard as the REST API (no GraphQL-only auth). Restricted or unverified users
 * are surfaced as a FORBIDDEN authError rather than silently allowed.
 */
export async function buildGraphQLContext(options: BuildContextOptions = {}): Promise<GraphQLContext> {
  const user = options.userOverride !== undefined ? options.userOverride : await getSessionUser();

  let authError: string | null = null;
  if (user) {
    authError = getApiRestrictionMessage(user) ?? getVerificationBlockMessage(user) ?? null;
  }

  const effectiveUser = authError ? null : user;

  return {
    user: effectiveUser,
    authError,
    requestId: randomUUID(),
    prisma,
    services: createProspectServices(prisma, options.aiClient),
    loaders: createLoaders(prisma, effectiveUser?.id ?? "__anonymous__"),
    defer: options.defer ?? ((task) => after(task))
  };
}
