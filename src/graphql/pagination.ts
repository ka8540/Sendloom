import { badInputError } from "@/graphql/errors";

export const MAX_PAGE_SIZE = 100;

/**
 * Resolve and bound a connection `first` argument. Unbounded or oversized page
 * sizes are rejected — GraphQL lists are never returned unbounded.
 */
export function resolveFirst(first: number | null | undefined, fallback = 20): number {
  const value = first ?? fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw badInputError("`first` must be a positive integer.");
  }
  if (value > MAX_PAGE_SIZE) {
    throw badInputError(`\`first\` must be at most ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

const CURSOR_PREFIX = "prospect-cursor:";

export function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): string | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded.startsWith(CURSOR_PREFIX)) {
      throw new Error("bad cursor");
    }
    return decoded.slice(CURSOR_PREFIX.length) || null;
  } catch {
    throw badInputError("Invalid pagination cursor.");
  }
}

export type Connection<T> = {
  edges: Array<{ node: T; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
};

/**
 * Build a Relay-style connection from `first + 1` fetched rows. The extra row
 * (if present) signals another page without a second query.
 */
export function buildConnection<T extends { id: string }>(rows: T[], first: number, totalCount: number): Connection<T> {
  const hasNextPage = rows.length > first;
  const nodes = hasNextPage ? rows.slice(0, first) : rows;
  const edges = nodes.map((node) => ({ node, cursor: encodeCursor(node.id) }));
  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
    },
    totalCount
  };
}

/** Standard cursor-paginated Prisma args (ordered newest first). */
export function cursorArgs(first: number, afterId: string | null) {
  return {
    take: first + 1,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {})
  };
}
