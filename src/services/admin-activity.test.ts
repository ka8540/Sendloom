import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUniqueMock, userFindManyMock, auditFindManyMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userFindManyMock: vi.fn(),
  auditFindManyMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
      findMany: userFindManyMock
    },
    auditLog: {
      findMany: auditFindManyMock
    }
  }
}));

import { listUserActivityEvents, searchActivityUsers } from "@/services/admin-activity";

function buildAuditRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "audit_1",
    actorUserId: "user_1",
    actorEmail: "kush@example.com",
    actorName: null,
    action: "sequence.launched",
    category: "SEQUENCE",
    severity: "SUCCESS",
    entityType: "sequence",
    entityId: "campaign_1",
    targetName: "Pinterest SDE List",
    message: "Launched sequence Pinterest SDE List (255 recipients).",
    metadata: { runId: "run_1", recipients: 255 },
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    createdAt: new Date("2026-06-03T19:01:00Z"),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUniqueMock.mockResolvedValue({ id: "user_1", email: "kush@example.com" });
  auditFindManyMock.mockResolvedValue([]);
});

describe("searchActivityUsers", () => {
  it("searches by email or exact id and maps user state", async () => {
    const future = new Date(Date.now() + 60_000);
    userFindManyMock.mockResolvedValueOnce([
      {
        id: "user_1",
        email: "kush@example.com",
        isAdmin: false,
        apiAccessDisabled: false,
        importsWriteDisabled: true,
        templatesWriteDisabled: false,
        launchesDisabled: false,
        aiEnhancementsDisabled: false,
        lastSeenAt: new Date("2026-06-01T10:00:00Z"),
        sessionExpiresAt: future,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        _count: { senderProfiles: 2 }
      }
    ]);

    const results = await searchActivityUsers("kush");

    expect(userFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ email: { contains: "kush", mode: "insensitive" } }, { id: "kush" }]
        },
        take: 8
      })
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "user_1",
      email: "kush@example.com",
      isAdmin: false,
      isRestricted: true,
      isLoggedIn: true,
      senderCount: 2
    });
  });

  it("returns recent users when the query is empty", async () => {
    userFindManyMock.mockResolvedValueOnce([]);

    await searchActivityUsers("   ");

    expect(userFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});

describe("listUserActivityEvents", () => {
  it("returns null when the user does not exist", async () => {
    userFindUniqueMock.mockResolvedValueOnce(null);

    expect(await listUserActivityEvents({ userId: "missing" })).toBeNull();
    expect(auditFindManyMock).not.toHaveBeenCalled();
  });

  it("matches both actorUserId and legacy actorEmail rows", async () => {
    await listUserActivityEvents({ userId: "user_1" });

    const where = auditFindManyMock.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ actorUserId: "user_1" }, { actorEmail: "kush@example.com" }]);
  });

  it("applies category, severity, object type, date, and search filters", async () => {
    const from = new Date("2026-06-01T00:00:00Z");

    await listUserActivityEvents({
      userId: "user_1",
      category: "SEQUENCE",
      severity: "ERROR",
      targetType: "import",
      from,
      search: "blackrock"
    });

    const where = auditFindManyMock.mock.calls[0][0].where;
    expect(where.category).toBe("SEQUENCE");
    expect(where.severity).toBe("ERROR");
    expect(where.entityType).toBe("import");
    expect(where.createdAt).toEqual({ gte: from });
    expect(where.AND).toEqual([
      {
        OR: [
          { action: { contains: "blackrock", mode: "insensitive" } },
          { message: { contains: "blackrock", mode: "insensitive" } },
          { targetName: { contains: "blackrock", mode: "insensitive" } }
        ]
      }
    ]);
  });

  it("paginates with a cursor and reports nextCursor only when more rows exist", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => buildAuditRow({ id: `audit_${index}` }));
    auditFindManyMock.mockResolvedValueOnce(rows);

    const firstPage = await listUserActivityEvents({ userId: "user_1" });

    expect(auditFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 26 }));
    expect(firstPage?.events).toHaveLength(25);
    expect(firstPage?.nextCursor).toBe("audit_24");

    auditFindManyMock.mockResolvedValueOnce(rows.slice(0, 5));
    const lastPage = await listUserActivityEvents({ userId: "user_1", cursor: "audit_24" });

    expect(auditFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: "audit_24" }, skip: 1 })
    );
    expect(lastPage?.events).toHaveLength(5);
    expect(lastPage?.nextCursor).toBeNull();
  });

  it("sanitizes credential-shaped metadata on the way out", async () => {
    auditFindManyMock.mockResolvedValueOnce([
      buildAuditRow({ metadata: { runId: "run_1", refreshToken: "1//secret" } })
    ]);

    const result = await listUserActivityEvents({ userId: "user_1" });

    expect(result?.events[0].metadata).toEqual({ runId: "run_1", refreshToken: "[redacted]" });
    expect(result?.events[0]).toMatchObject({
      action: "sequence.launched",
      targetType: "sequence",
      targetId: "campaign_1",
      targetName: "Pinterest SDE List",
      createdAt: "2026-06-03T19:01:00.000Z"
    });
  });
});
