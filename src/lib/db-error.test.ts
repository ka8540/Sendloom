import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_DATABASE_ERROR_MESSAGE,
  databaseErrorCode,
  isDatabaseError,
  logDatabaseError,
  sanitizeDatabaseError
} from "@/lib/db-error";

// A realistic, leaky Prisma message — it names the table and columns, exactly
// the kind of internal detail that must never reach a client.
const LEAKY_MESSAGE = "Unique constraint failed on the fields: (`User`.`email`)";

function knownRequestError(code = "P2002") {
  return new Prisma.PrismaClientKnownRequestError(LEAKY_MESSAGE, {
    code,
    clientVersion: "6.0.0"
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isDatabaseError", () => {
  it("recognizes Prisma client errors", () => {
    expect(isDatabaseError(knownRequestError())).toBe(true);
    expect(isDatabaseError(new Prisma.PrismaClientValidationError("bad query", { clientVersion: "6.0.0" }))).toBe(true);
  });

  it("returns false for non-database errors", () => {
    expect(isDatabaseError(new Error("boom"))).toBe(false);
    expect(isDatabaseError(new TypeError("nope"))).toBe(false);
    expect(isDatabaseError("just a string")).toBe(false);
    expect(isDatabaseError(null)).toBe(false);
    expect(isDatabaseError(undefined)).toBe(false);
  });
});

describe("databaseErrorCode", () => {
  it("returns the Prisma code for known request errors", () => {
    expect(databaseErrorCode(knownRequestError("P2025"))).toBe("P2025");
  });

  it("returns null when no code is available", () => {
    expect(databaseErrorCode(new Error("boom"))).toBeNull();
  });
});

describe("sanitizeDatabaseError", () => {
  it("replaces a leaky database error with the generic public message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = sanitizeDatabaseError(knownRequestError(), { operation: "POST /api/templates", userId: "user_1" });

    expect(result).toBe(PUBLIC_DATABASE_ERROR_MESSAGE);
    // The public message must not echo any of the leaked internals.
    expect(result).not.toContain("User");
    expect(result).not.toContain("email");
    expect(result).not.toContain("constraint");
  });

  it("returns null for non-database errors so app-authored messages survive", () => {
    expect(sanitizeDatabaseError(new Error("Enter a company domain."), { operation: "x" })).toBeNull();
  });

  it("logs only safe diagnostics — never the raw message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    sanitizeDatabaseError(knownRequestError("P2002"), { operation: "POST /api/templates", userId: "user_42" });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain("operation=POST /api/templates");
    expect(logged).toContain("userId=user_42");
    expect(logged).toContain("prismaCode=P2002");
    // The raw, leaky message and its internals must never be logged.
    expect(logged).not.toContain(LEAKY_MESSAGE);
    expect(logged).not.toContain("email");
  });

  it("falls back to anonymous when no user id is supplied", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logDatabaseError(knownRequestError(), { operation: "CRON /cron" });

    expect(String(spy.mock.calls[0][0])).toContain("userId=anonymous");
  });
});
