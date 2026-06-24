import { Prisma } from "@prisma/client";
import { GraphQLError, type GraphQLObjectType } from "graphql";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PAGE_SIZE, decodeCursor, encodeCursor, resolveFirst } from "@/graphql/pagination";
import { mapProspectError } from "@/graphql/resolvers/helpers";
import { prospectSchema } from "@/graphql/server";

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw, but it did not.");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GraphQL pagination guards reject malicious paging input", () => {
  it("rejects oversized `first`", () => {
    expect(() => resolveFirst(MAX_PAGE_SIZE + 1)).toThrow(GraphQLError);
    expect(() => resolveFirst(1_000_000)).toThrow(/at most/);
  });

  it("rejects non-positive and non-integer `first`", () => {
    expect(() => resolveFirst(0)).toThrow(GraphQLError);
    expect(() => resolveFirst(-10)).toThrow(GraphQLError);
    expect(() => resolveFirst(1.5)).toThrow(GraphQLError);
    expect(() => resolveFirst(Number.NaN)).toThrow(GraphQLError);
  });

  it("accepts valid `first` and applies the server fallback", () => {
    expect(resolveFirst(20)).toBe(20);
    expect(resolveFirst(null, 25)).toBe(25);
    expect(resolveFirst(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it("rejects a malicious cursor with a safe BAD_USER_INPUT error — not a database error", () => {
    for (const malicious of ["'; DROP TABLE \"ProspectPerson\"; --", "not-a-cursor", "%%%%", "../../etc/passwd"]) {
      const error = catchError(() => decodeCursor(malicious)) as GraphQLError;
      expect(error).toBeInstanceOf(GraphQLError);
      expect(error.extensions.code).toBe("BAD_USER_INPUT");
      // The user gets a clean validation message, never raw SQL/DB internals.
      expect(error.message).toBe("Invalid pagination cursor.");
    }
  });

  it("round-trips a legitimately encoded cursor", () => {
    expect(decodeCursor(encodeCursor("ckabc123"))).toBe("ckabc123");
    expect(decodeCursor(null)).toBeNull();
  });
});

describe("GraphQL API surface cannot accept raw Prisma where/orderBy", () => {
  // Argument names that would let a client smuggle in a raw filter, ordering, or
  // SQL fragment. The server must map approved inputs into Prisma objects itself.
  const FORBIDDEN_ARG_NAMES = new Set(["where", "orderby", "sort", "direction", "sql", "filter", "having", "groupby"]);

  function fieldArgNames(type: GraphQLObjectType | null | undefined): string[] {
    if (!type) {
      return [];
    }
    const names: string[] = [];
    for (const field of Object.values(type.getFields())) {
      for (const arg of field.args) {
        names.push(`${field.name}.${arg.name}`);
      }
    }
    return names;
  }

  it("exposes no where/orderBy/sort/direction argument on any query or mutation", () => {
    const argPaths = [
      ...fieldArgNames(prospectSchema.getQueryType()),
      ...fieldArgNames(prospectSchema.getMutationType())
    ];

    for (const argPath of argPaths) {
      const argName = argPath.split(".")[1]?.toLowerCase() ?? "";
      expect(FORBIDDEN_ARG_NAMES.has(argName), `argument ${argPath} must not be client-controllable`).toBe(false);
    }

    // Guard against a vacuous pass if the schema ever stops exposing arguments.
    expect(argPaths.length).toBeGreaterThan(5);
  });
});

describe("mapProspectError sanitizes raw database errors", () => {
  it("masks a Prisma error as a generic internal error with no schema leak", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const dbError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`ProspectPerson`.`email`)",
      { code: "P2002", clientVersion: "6.0.0" }
    );

    const thrown = catchError(() => mapProspectError(dbError)) as GraphQLError;

    expect(thrown).toBeInstanceOf(GraphQLError);
    expect(thrown.extensions.code).toBe("INTERNAL_SERVER_ERROR");
    expect(thrown.message).not.toContain("ProspectPerson");
    expect(thrown.message).not.toContain("email");
    expect(thrown.message).not.toContain("constraint");
  });

  it("does not leak the raw Prisma message even via validation errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const validationError = new Prisma.PrismaClientValidationError(
      "Argument `where` of type ProspectPersonWhereInput needs at least one field",
      { clientVersion: "6.0.0" }
    );

    const thrown = catchError(() => mapProspectError(validationError)) as GraphQLError;

    expect(thrown.extensions.code).toBe("INTERNAL_SERVER_ERROR");
    expect(thrown.message).not.toContain("ProspectPersonWhereInput");
  });
});
