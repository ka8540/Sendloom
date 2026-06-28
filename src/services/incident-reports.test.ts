import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, rateLimitMock, redisGetMock, redisSetMock, recordAuditMock } = vi.hoisted(() => ({
  prismaMock: {
    appErrorEvent: { findFirst: vi.fn(), create: vi.fn() },
    incidentReport: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn()
    }
  },
  rateLimitMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  recordAuditMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/redis", () => ({ getRedis: () => ({ get: redisGetMock, set: redisSetMock }) }));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: recordAuditMock,
  sanitizeAuditMetadata: (value: unknown) => value
}));

import { reporterPseudonym } from "@/lib/incident/identity";
import {
  createIncidentReport,
  getAdminIncidentDetail,
  listAdminIncidents
} from "@/services/incident-reports";

const ACTOR = { id: "user_1", email: "user@example.com" };

function eventRow(overrides: Record<string, unknown> = {}) {
  return { id: "evt_1", publicEventId: "EVT-AAAA", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
  redisGetMock.mockResolvedValue(null);
  redisSetMock.mockResolvedValue("OK");
  prismaMock.appErrorEvent.findFirst.mockResolvedValue(null);
  prismaMock.appErrorEvent.create.mockResolvedValue(eventRow());
  prismaMock.incidentReport.findFirst.mockResolvedValue(null);
  prismaMock.incidentReport.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...args.data,
    status: "NEW"
  }));
  prismaMock.incidentReport.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    publicReportId: "INC-EXIST",
    status: "NEW",
    ...args.data
  }));
});

describe("createIncidentReport", () => {
  it("creates exactly one report for a fresh failure", async () => {
    const result = await createIncidentReport(
      { category: "SERVER_ERROR", feature: "Sequences", operation: "Launch sequence", httpStatus: 500 },
      ACTOR
    );

    expect(result).toMatchObject({ ok: true, deduplicated: false });
    expect(prismaMock.incidentReport.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.incidentReport.update).not.toHaveBeenCalled();
  });

  it("deduplicates an identical failure from the same reporter and increments occurrenceCount", async () => {
    prismaMock.incidentReport.findFirst.mockResolvedValue({
      id: "rep_1",
      publicReportId: "INC-EXIST",
      occurrenceCount: 1,
      status: "NEW",
      userNote: null
    });

    const result = await createIncidentReport(
      { category: "SERVER_ERROR", feature: "Sequences", operation: "Launch sequence", httpStatus: 500 },
      ACTOR
    );

    expect(result).toMatchObject({ ok: true, deduplicated: true });
    expect(prismaMock.incidentReport.create).not.toHaveBeenCalled();
    expect(prismaMock.incidentReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ occurrenceCount: 2 }) })
    );
  });

  it("returns RATE_LIMITED without creating anything when the reporter is over the limit", async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });

    const result = await createIncidentReport(
      { category: "SERVER_ERROR", feature: "Sequences", operation: "Launch sequence" },
      ACTOR
    );

    expect(result).toEqual({ ok: false, reason: "RATE_LIMITED" });
    expect(prismaMock.incidentReport.create).not.toHaveBeenCalled();
  });

  it("is idempotent for an exact replay (same key) and never consumes a rate-limit slot", async () => {
    redisGetMock.mockResolvedValue("INC-EXIST");
    prismaMock.incidentReport.findUnique.mockResolvedValue({ publicReportId: "INC-EXIST", status: "INVESTIGATING" });

    const result = await createIncidentReport(
      { category: "SERVER_ERROR", feature: "Sequences", operation: "Launch sequence", idempotencyKey: "key-1" },
      ACTOR
    );

    expect(result).toEqual({ ok: true, reportId: "INC-EXIST", status: "INVESTIGATING", deduplicated: true });
    expect(prismaMock.incidentReport.create).not.toHaveBeenCalled();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied severity / pseudonym and derives them server-side", async () => {
    await createIncidentReport(
      {
        category: "CLIENT_RENDER",
        feature: "X",
        operation: "Y",
        // Spoof attempts — must be ignored:
        severity: "CRITICAL",
        reporterPseudonym: "U-FAKE-FAKE",
        status: "RESOLVED",
        occurrenceCount: 999
      } as never,
      ACTOR
    );

    const data = prismaMock.incidentReport.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.severity).toBe("LOW"); // CLIENT_RENDER, first occurrence
    expect(data.reporterPseudonym).toBe(reporterPseudonym("user_1"));
    expect(data.reporterPseudonym).not.toBe("U-FAKE-FAKE");
    // Encrypted reference is stored, never the raw id.
    expect(typeof data.encryptedReporterRef).toBe("string");
    expect(data.encryptedReporterRef).not.toContain("user_1");
  });
});

describe("admin DTOs never expose identity or encrypted columns", () => {
  const ROW = {
    publicReportId: "INC-1",
    reporterPseudonym: "U-AAAA-BBBB",
    severity: "HIGH",
    status: "NEW",
    occurrenceCount: 3,
    firstSeenAt: new Date("2026-06-01T00:00:00Z"),
    lastSeenAt: new Date("2026-06-02T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    diagnosticFingerprint: "fp123",
    userNote: "I clicked launch and it spun forever",
    adminNotes: null,
    encryptedReporterRef: "SECRET_CIPHERTEXT_VALUE",
    encryptedReporterIv: "SECRET_IV_VALUE",
    encryptedReporterTag: "SECRET_TAG_VALUE",
    errorEvent: {
      feature: "Sequences",
      operation: "Launch sequence",
      category: "SERVER_ERROR",
      appVersion: "1.2.3",
      internalCode: "PG_DEADLOCK",
      httpStatus: 500,
      correlationId: "req_x",
      route: "/campaigns/:id",
      requestMethod: "POST",
      browserFamily: "Chrome",
      platform: "macOS",
      onlineStatus: true,
      retryable: true,
      serverStackFingerprint: null,
      sanitizedContext: { retryCount: 1 },
      occurredAt: new Date("2026-06-02T00:00:00Z")
    }
  };

  it("listAdminIncidents omits the encrypted reporter columns + raw identity", async () => {
    prismaMock.incidentReport.findMany.mockResolvedValue([ROW]);
    prismaMock.incidentReport.count.mockResolvedValue(1);

    const result = await listAdminIncidents({}, null);
    const serialized = JSON.stringify(result);

    expect(result.items[0].reporterPseudonym).toBe("U-AAAA-BBBB");
    expect(serialized).not.toContain("SECRET_CIPHERTEXT_VALUE");
    expect(serialized).not.toContain("encryptedReporter");
  });

  it("getAdminIncidentDetail exposes safe diagnostics but no encrypted identity", async () => {
    prismaMock.incidentReport.findUnique.mockResolvedValue(ROW);

    const detail = await getAdminIncidentDetail("INC-1");
    const serialized = JSON.stringify(detail);

    expect(detail?.correlationId).toBe("req_x");
    expect(detail?.userNote).toContain("spun forever");
    expect(serialized).not.toContain("SECRET_CIPHERTEXT_VALUE");
    expect(serialized).not.toContain("SECRET_IV_VALUE");
    expect(serialized).not.toMatch(/encryptedReporter/);
  });
});
