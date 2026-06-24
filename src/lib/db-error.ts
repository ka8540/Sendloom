import { Prisma } from "@prisma/client";

// Centralized database-error sanitizer.
//
// Raw Prisma/PostgreSQL errors carry engineering detail that must never reach a
// user: SQL fragments, table and column names, constraint internals, the schema
// name, the database host, and sometimes the offending query parameters. This
// module is the single place that decides "is this a database error?" and what
// the public, user-safe replacement looks like.
//
// Pure on purpose: it imports neither `next/server` nor any runtime client, so
// it can be used by REST route handlers, GraphQL resolvers, background jobs, and
// unit tests alike. Callers turn the safe message into their own transport shape
// (NextResponse JSON, a GraphQLError, a thrown Error, …).

/** The only database-error copy a user is ever allowed to see. Generic + actionable. */
export const PUBLIC_DATABASE_ERROR_MESSAGE =
  "The request could not be completed. Please check the provided information and try again.";

/**
 * True when `error` originates from Prisma / the database layer. Covers every
 * Prisma client error class, so a new variant cannot slip a raw message through
 * by being an unhandled subtype.
 */
export function isDatabaseError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}

/**
 * The Prisma error code (e.g. "P2002") when available. Safe to log and to branch
 * on server-side; it is never returned to the client.
 */
export function databaseErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ?? null;
  }
  return null;
}

export type DatabaseErrorLogContext = {
  /** Stable identifier for the failing operation, e.g. "POST /api/templates". */
  operation: string;
  /** Authenticated user id, when known. Never an email, token, or payload. */
  userId?: string | null;
};

/**
 * Record SAFE diagnostics for a database error in the server logs. Logs only the
 * operation, the authenticated user id, the Prisma error code, and the error
 * class name — deliberately NOT the raw message, the failing query, the query
 * parameters, or any user-supplied payload, so logs cannot become a leak channel
 * of their own.
 */
export function logDatabaseError(error: unknown, context: DatabaseErrorLogContext): void {
  const code = databaseErrorCode(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `[db-error] operation=${context.operation} userId=${context.userId ?? "anonymous"} ` +
      `prismaCode=${code ?? "n/a"} errorName=${name}`
  );
}

/**
 * If `error` is a database error, log safe diagnostics and return the public,
 * sanitized message. Returns `null` for any non-database error so the caller can
 * keep its own (app-authored, already-safe) handling for domain errors.
 */
export function sanitizeDatabaseError(error: unknown, context: DatabaseErrorLogContext): string | null {
  if (!isDatabaseError(error)) {
    return null;
  }
  logDatabaseError(error, context);
  return PUBLIC_DATABASE_ERROR_MESSAGE;
}
