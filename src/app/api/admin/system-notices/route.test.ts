import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, listMock, createMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/system-notices", () => ({
  listSystemNotices: listMock,
  createSystemNotice: createMock
}));

import { GET, POST } from "@/app/api/admin/system-notices/route";

const admin = { id: "admin-1", email: "admin@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("admin system-notice API authorization", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "non-admin"]
  ])("returns %s for an %s request without touching notice data", async (status) => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status }) });
    const response = await GET(new Request("http://localhost/api/admin/system-notices"));
    expect(response!.status).toBe(status);
    expect(listMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("lets an admin list aggregate notice history", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    listMock.mockResolvedValue({ notices: [], accountRecipientCount: 4, summary: {} });
    const response = await GET(new Request("http://localhost/api/admin/system-notices"));
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ accountRecipientCount: 4, notices: [] });
  });

  it("lets an admin create a validated draft and rejects invalid content first", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    createMock.mockResolvedValue({ id: "notice-1", status: "DRAFT" });
    const valid = {
      type: "GENERAL",
      subject: "Sendloom service notice",
      title: "Service update",
      message: "An operational update.",
      affectedArea: null,
      scheduledSendAt: null,
      impactStartsAt: null,
      impactEndsAt: null,
      timeZone: "America/Phoenix"
    };
    const created = await POST(
      new Request("http://localhost/api/admin/system-notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid)
      })
    );
    expect(created!.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ subject: valid.subject }), admin, expect.any(Request));

    const rejected = await POST(
      new Request("http://localhost/api/admin/system-notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...valid, subject: "", message: " " })
      })
    );
    expect(rejected!.status).toBe(400);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
