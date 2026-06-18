import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/csrf";
import { env } from "@/lib/env";
import { createProspectYoga, resolveGraphiqlEnabled } from "@/graphql/server";

// GraphQL must run on the Node.js runtime (Prisma, crypto, env) and never be
// statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

// The Yoga instance is built lazily on first request. Env is intentionally NOT
// read at module scope: production builds collect page data with
// NODE_ENV=production, and eager env parsing there would demand production-only
// secrets the local/build environment may not have.
let yogaInstance: ReturnType<typeof createProspectYoga> | null = null;

function getYoga() {
  if (yogaInstance) {
    return yogaInstance;
  }

  const isProduction = process.env.NODE_ENV === "production";
  // GraphiQL is only ever served locally: never in production, and only when the
  // operator explicitly opts in via GRAPHQL_GRAPHIQL_ENABLED.
  const graphiqlEnabled = resolveGraphiqlEnabled(process.env.NODE_ENV, env.GRAPHQL_GRAPHIQL_ENABLED);

  yogaInstance = createProspectYoga({
    // Disable introspection in production (the feature is off there anyway).
    disableIntrospection: isProduction,
    graphiql: graphiqlEnabled
      ? (request: Request) => {
          // Pre-fill the CSRF header so mutations/queries (POST) pass the global
          // CSRF middleware. The token is read from the same cookie the browser
          // already holds; on a brand-new session reload once so the cookie sets.
          const csrf = readCookie(request, CSRF_COOKIE);
          return {
            title: "Sendloom Prospect GraphQL",
            credentials: "same-origin",
            headers: csrf ? JSON.stringify({ [CSRF_HEADER]: csrf }, null, 2) : undefined
          };
        }
      : false
  });

  return yogaInstance;
}

function disabledResponse(): Response {
  return new Response(JSON.stringify({ error: "Prospect graph is not enabled." }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });
}

async function handle(request: Request): Promise<Response> {
  // Hard feature flag. Disabled by default (and in production) — requests are
  // rejected before any resolver or provider code runs.
  if (!env.PROSPECT_GRAPH_ENABLED) {
    return disabledResponse();
  }
  return getYoga().handleRequest(request, {});
}

export { handle as GET, handle as POST, handle as OPTIONS };
