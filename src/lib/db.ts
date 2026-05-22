import { PrismaClient } from "@prisma/client";

function withVercelConnectionSafety(databaseUrl: string | undefined) {
  if (!databaseUrl || !process.env.VERCEL) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return databaseUrl;
    }

    if (!url.searchParams.has("pgbouncer") && !url.searchParams.has("statement_cache_size")) {
      url.searchParams.set("pgbouncer", "true");
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function isCachedPlanResultTypeError(error: unknown) {
  return error instanceof Error && error.message.includes("cached plan must not change result type");
}

function createPrismaClient() {
  const databaseUrl = withVercelConnectionSafety(process.env.DATABASE_URL);
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
    ...(databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl
            }
          }
        }
      : {})
  });

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args);
          } catch (error) {
            if (!isCachedPlanResultTypeError(error)) {
              throw error;
            }

            await client.$disconnect();
            return query(args);
          }
        }
      }
    }
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
