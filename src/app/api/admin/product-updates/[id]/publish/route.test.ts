import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, publishMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  publishMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/product-updates", () => ({ publishProductUpdate: publishMock }));

import { ProductUpdateActionError } from "@/lib/product-updates";
import { POST } from "@/app/api/admin/product-updates/[id]/publish/route";

const admin = { id: "admin-1", email: "admin@example.com" };
const context = { params: Promise.resolve({ id: "update-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("publish product update", () => {
  it("requires admin", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 403 }) });

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response!.status).toBe(403);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("publishes through the service (which stamps publishedAt)", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    publishMock.mockResolvedValue({ id: "update-1", status: "PUBLISHED", publishedAt: "2026-08-26T15:00:00.000Z" });

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);

    expect(response!.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith("update-1", admin, expect.any(Request));
    expect(await response!.json()).toMatchObject({ status: "PUBLISHED", publishedAt: "2026-08-26T15:00:00.000Z" });
  });

  it("maps lifecycle conflicts to 409", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    publishMock.mockRejectedValue(new ProductUpdateActionError("This product update is already published."));

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response!.status).toBe(409);
  });
});
