import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/system-health", () => ({ getSystemHealth: vi.fn() }));
import { normalizeAdminRange, safeRate } from "./analytics";
import { normalizeUserStatus, userStatusWhere } from "./users";
import { deriveAttention } from "./overview";
import type { SystemHealthReport } from "@/lib/system-health";

describe("Admin V2 query state", () => {
  it("accepts only supported analytics ranges and avoids invalid percentages", () => {
    expect(normalizeAdminRange("30")).toBe(30);
    expect(normalizeAdminRange("90")).toBe(90);
    expect(normalizeAdminRange("999")).toBe(7);
    expect(safeRate(3, 0)).toBeNull();
    expect(safeRate(3, 6)).toBe(50);
  });
  it("normalizes user filters and enforces a 24-hour active window", () => {
    expect(normalizeUserStatus("restricted")).toBe("restricted");
    expect(normalizeUserStatus("unknown")).toBe("all");
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(userStatusWhere("active", now)).toEqual({
      isAdmin: false,
      lastSeenAt: { gte: new Date("2026-09-30T12:00:00.000Z") },
    });
    expect(userStatusWhere("restricted")).toMatchObject({
      OR: expect.arrayContaining([
        { restrictedAt: { not: null } },
        { apiAccessDisabled: true },
      ]),
    });
  });
});

describe("Admin attention", () => {
  const ok = { status: "ok", message: "Available" } as const;
  const configured = { status: "configured", message: "Configured" } as const;
  const health: SystemHealthReport = {
    status: "ok",
    timestamp: "2026-10-01T12:00:00.000Z",
    checks: {
      database: ok,
      redis: ok,
      storage: ok,
      appBaseUrl: configured,
      sessionSecret: configured,
      googleOAuth: configured,
      mailProvider: configured,
      cron: configured,
    },
  };
  it("does not invent alerts when all stored/current signals are clear", () => {
    expect(
      deriveAttention({
        health,
        incidents: [],
        failedRuns: 0,
        failedNotices: 0,
        failedUpdates: 0,
      }),
    ).toEqual([]);
  });
  it("links service, incident, and delivery issues to their workspaces", () => {
    const result = deriveAttention({
      health: {
        ...health,
        checks: {
          ...health.checks,
          redis: { status: "down", message: "Redis unavailable" },
        },
      },
      incidents: [
        {
          publicReportId: "INC-1",
          severity: "CRITICAL",
          lastSeenAt: new Date("2026-10-01T11:00:00.000Z"),
        },
      ],
      failedRuns: 2,
      failedNotices: 1,
      failedUpdates: 0,
    });
    expect(result.map((item) => item.href)).toEqual([
      "/admin/operations",
      "/admin/operations/incidents",
      "/admin/operations/sending",
      "/admin/communications/system-notices",
    ]);
    expect(result[0].tone).toBe("danger");
  });
});
