import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, archiveMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  archiveMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/product-updates", () => ({ archiveProductUpdate: archiveMock }));

import { POST } from "@/app/api/admin/product-updates/[id]/archive/route";

const admin = { id: "admin-1", email: "admin@example.com" };
const context = { params: Promise.resolve({ id: "update-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("archive product update", () => {
  it("requires admin", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 403 }) });

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response!.status).toBe(403);
    expect(archiveMock).not.toHaveBeenCalled();
  });

  it("archives through the service, which keeps database history", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    archiveMock.mockResolvedValue({ id: "update-1", status: "ARCHIVED" });

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);

    expect(response!.status).toBe(200);
    expect(archiveMock).toHaveBeenCalledWith("update-1", admin, expect.any(Request));
    expect(await response!.json()).toMatchObject({ status: "ARCHIVED" });
  });
});
