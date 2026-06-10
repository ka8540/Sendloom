import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditLogCreateMock } = vi.hoisted(() => ({
  auditLogCreateMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      create: auditLogCreateMock
    }
  }
}));

import { recordAuditEvent, sanitizeAuditMetadata } from "@/lib/audit";

beforeEach(() => {
  vi.clearAllMocks();
  auditLogCreateMock.mockResolvedValue({ id: "audit_1" });
});

describe("sanitizeAuditMetadata", () => {
  it("redacts credential-like keys", () => {
    const sanitized = sanitizeAuditMetadata({
      accessToken: "ya29.secret",
      refreshToken: "1//refresh",
      oauthRefreshToken: "1//refresh",
      password: "hunter2",
      hunterApiKey: "abc123",
      authorization: "Bearer xyz",
      htmlBody: "<p>full email body</p>",
      fileName: "BlackRock.csv",
      rowCount: 255
    });

    expect(sanitized).toEqual({
      accessToken: "[redacted]",
      refreshToken: "[redacted]",
      oauthRefreshToken: "[redacted]",
      password: "[redacted]",
      hunterApiKey: "[redacted]",
      authorization: "[redacted]",
      htmlBody: "[redacted]",
      fileName: "BlackRock.csv",
      rowCount: 255
    });
  });

  it("redacts sensitive keys in nested objects", () => {
    const sanitized = sanitizeAuditMetadata({
      sender: {
        email: "kush@example.com",
        oauthRefreshToken: "1//refresh"
      }
    });

    expect(sanitized).toEqual({
      sender: {
        email: "kush@example.com",
        oauthRefreshToken: "[redacted]"
      }
    });
  });

  it("truncates long strings", () => {
    const sanitized = sanitizeAuditMetadata({ note: "x".repeat(1000) });
    expect((sanitized?.note as string).length).toBeLessThanOrEqual(301);
    expect(sanitized?.note as string).toMatch(/…$/);
  });

  it("caps depth, key count, and array size", () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key${i}`, i]));
    const sanitized = sanitizeAuditMetadata({
      ...wide,
      deep: { a: { b: { c: { d: "too deep" } } } },
      list: Array.from({ length: 40 }, (_, i) => i)
    });

    expect(Object.keys(sanitized ?? {}).length).toBeLessThanOrEqual(24);

    const deepest = sanitizeAuditMetadata({ deep: { a: { b: { c: "value" } } } });
    expect((deepest?.deep as Record<string, unknown>).a).toEqual({ b: "[object]" });
  });

  it("returns undefined for non-object metadata", () => {
    expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
    expect(sanitizeAuditMetadata("string")).toBeUndefined();
    expect(sanitizeAuditMetadata([1, 2, 3])).toBeUndefined();
  });
});

describe("recordAuditEvent", () => {
  it("writes a sanitized event with actor, category, and target", async () => {
    await recordAuditEvent({
      actor: { id: "user_1", email: "kush@example.com" },
      action: "sequence.launched",
      category: "SEQUENCE",
      severity: "SUCCESS",
      target: { type: "campaign", id: "campaign_1", name: "Pinterest SDE List" },
      message: "Sequence launched",
      metadata: { runId: "run_1", recipients: 255, accessToken: "leak" }
    });

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const data = auditLogCreateMock.mock.calls[0][0].data;
    expect(data.actorUserId).toBe("user_1");
    expect(data.actorEmail).toBe("kush@example.com");
    expect(data.category).toBe("SEQUENCE");
    expect(data.severity).toBe("SUCCESS");
    expect(data.entityType).toBe("campaign");
    expect(data.entityId).toBe("campaign_1");
    expect(data.targetName).toBe("Pinterest SDE List");
    expect(data.metadata).toEqual({ runId: "run_1", recipients: 255, accessToken: "[redacted]" });
  });

  it("captures ip and user-agent from the request headers", async () => {
    const request = new Request("https://sendloom.test/api/templates", {
      headers: {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "Mozilla/5.0 (test)"
      }
    });

    await recordAuditEvent({
      actor: { id: "user_1", email: "kush@example.com" },
      action: "template.created",
      category: "TEMPLATE",
      request
    });

    const data = auditLogCreateMock.mock.calls[0][0].data;
    expect(data.ipAddress).toBe("203.0.113.7");
    expect(data.userAgent).toBe("Mozilla/5.0 (test)");
  });

  it("defaults severity to INFO and never throws when the write fails", async () => {
    auditLogCreateMock.mockRejectedValueOnce(new Error("db down"));

    await expect(
      recordAuditEvent({
        actor: { email: "kush@example.com" },
        action: "auth.login",
        category: "AUTH"
      })
    ).resolves.toBeUndefined();

    auditLogCreateMock.mockResolvedValueOnce({ id: "audit_2" });
    await recordAuditEvent({
      actor: { email: "kush@example.com" },
      action: "auth.login",
      category: "AUTH"
    });
    expect(auditLogCreateMock.mock.calls[1][0].data.severity).toBe("INFO");
  });

  it("rethrows write failures for critical events", async () => {
    auditLogCreateMock.mockRejectedValueOnce(new Error("db down"));

    await expect(
      recordAuditEvent({
        actor: { id: "admin_1", email: "admin@example.com" },
        action: "admin.user.delete_all_data",
        category: "ADMIN",
        severity: "SECURITY",
        critical: true
      })
    ).rejects.toThrow("db down");
  });
});
