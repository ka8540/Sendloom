import { beforeEach, describe, expect, it, vi } from "vitest";

// Representative SQL-injection payloads. Every one must be handled as ORDINARY
// STRING DATA by Prisma (a value placeholder), never as SQL that can change a
// query's structure, broaden results, bypass tenant scope, or delete rows.
const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "'; DROP TABLE users; --",
  '" OR ""="',
  "admin'--",
  "' UNION SELECT NULL--",
  "test@example.com' OR '1'='1",
  "%27%20OR%201%3D1--",
  "1; SELECT pg_sleep(5); --",
  "Robert'); DROP TABLE Students;--",
  "\\'; DROP TABLE x; --",
  "наш'; DROP--"
] as const;

const {
  userFindManyMock,
  userFindUniqueMock,
  auditFindManyMock,
  suppressionFindFirstMock,
  suppressionDeleteMock
} = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  auditFindManyMock: vi.fn(),
  suppressionFindFirstMock: vi.fn(),
  suppressionDeleteMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: userFindManyMock, findUnique: userFindUniqueMock },
    auditLog: { findMany: auditFindManyMock, count: vi.fn(), findFirst: vi.fn() },
    suppression: { findFirst: suppressionFindFirstMock, delete: suppressionDeleteMock }
  }
}));

import { listUserActivityEvents, searchActivityUsers } from "@/services/admin-activity";
import { deleteSuppression } from "@/services/suppressions";

beforeEach(() => {
  vi.clearAllMocks();
  userFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ id: "user_1", email: "owner@example.com" });
  auditFindManyMock.mockResolvedValue([]);
});

describe("admin user search treats SQLi payloads as parameterized values", () => {
  it.each(SQLI_PAYLOADS)("payload %s lands only in value positions", async (payload) => {
    await searchActivityUsers(payload);

    const args = userFindManyMock.mock.calls.at(-1)?.[0];
    // The query STRUCTURE is identical regardless of payload — the payload is a
    // value, never an operator, column, or fragment.
    expect(args.where).toEqual({
      OR: [{ email: { contains: payload, mode: "insensitive" } }, { id: payload }]
    });
    // Sort field and direction are server-fixed; user input cannot reach them.
    expect(args.orderBy).toEqual([{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]);
    // Page size is server-fixed; a payload cannot widen the result window.
    expect(args.take).toBe(8);
  });

  it("does not broaden results — an injection string still produces a scoped filter", async () => {
    await searchActivityUsers("' OR 1=1 --");
    const args = userFindManyMock.mock.calls.at(-1)?.[0];
    // It is NOT an unfiltered query: the payload is required to match as data.
    expect(args.where).not.toBeUndefined();
    expect(JSON.stringify(args.where)).toContain("' OR 1=1 --");
  });
});

describe("audit-log filtering keeps tenant scope and parameterizes search", () => {
  it.each(SQLI_PAYLOADS)("search payload %s cannot escape its value position", async (payload) => {
    await listUserActivityEvents({ userId: "user_1", search: payload });

    const args = auditFindManyMock.mock.calls.at(-1)?.[0];
    // Tenant ownership is always present and server-generated.
    expect(args.where.OR).toEqual([{ actorUserId: "user_1" }, { actorEmail: "owner@example.com" }]);
    // The search term is a value across each searchable column.
    expect(args.where.AND).toEqual([
      {
        OR: [
          { action: { contains: payload, mode: "insensitive" } },
          { message: { contains: payload, mode: "insensitive" } },
          { targetName: { contains: payload, mode: "insensitive" } }
        ]
      }
    ]);
  });

  it("clamps malicious pagination to the server maximum", async () => {
    await listUserActivityEvents({ userId: "user_1", limit: 100000 });
    expect(auditFindManyMock.mock.calls.at(-1)?.[0].take).toBe(51); // ACTIVITY_MAX_PAGE_SIZE (50) + 1

    await listUserActivityEvents({ userId: "user_1", limit: -5 });
    expect(auditFindManyMock.mock.calls.at(-1)?.[0].take).toBe(2); // min 1 + 1
  });

  it("passes a malicious cursor through as a value, never as SQL", async () => {
    const cursor = "'; DROP TABLE AuditLog; --";
    await listUserActivityEvents({ userId: "user_1", cursor });
    const args = auditFindManyMock.mock.calls.at(-1)?.[0];
    expect(args.cursor).toEqual({ id: cursor });
    expect(args.skip).toBe(1);
  });
});

describe("malicious record ids cannot bypass tenant ownership or delete rows", () => {
  it.each(SQLI_PAYLOADS)("deleteSuppression scopes id %s to the owner", async (payload) => {
    suppressionFindFirstMock.mockResolvedValueOnce(null);

    const result = await deleteSuppression("user_1", payload);

    // Ownership lookup is by (id AND userId) with the payload as a value.
    expect(suppressionFindFirstMock).toHaveBeenCalledWith({ where: { id: payload, userId: "user_1" } });
    // No matching owned row -> nothing is deleted.
    expect(suppressionDeleteMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("only deletes the row already confirmed to belong to the user", async () => {
    suppressionFindFirstMock.mockResolvedValueOnce({ id: "supp_1", userId: "user_1" });

    await deleteSuppression("user_1", "supp_1");

    expect(suppressionDeleteMock).toHaveBeenCalledWith({ where: { id: "supp_1" } });
  });
});
