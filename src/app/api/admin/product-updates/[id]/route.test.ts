import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, getMock, updateMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  getMock: vi.fn(),
  updateMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/product-updates", () => ({
  getAdminProductUpdate: getMock,
  updateProductUpdate: updateMock
}));

import { ProductUpdateActionError } from "@/lib/product-updates";
import { GET, PATCH } from "@/app/api/admin/product-updates/[id]/route";

const admin = { id: "admin-1", email: "admin@example.com" };
const context = { params: Promise.resolve({ id: "update-1" }) };

const validBody = {
  title: "Make your Sendloom account yours",
  summary: "You can now upload a personal profile photo.",
  description: "Add, change, or remove your profile photo from Account settings.",
  icon: "USER",
  ctaLabel: "Add profile photo",
  ctaHref: "/account"
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("admin product-update detail API", () => {
  it("blocks non-admin reads and writes", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 403 }) });

    expect((await GET(new Request("http://localhost"), context))!.status).toBe(403);
    expect(
      (
        await PATCH(
          new Request("http://localhost", { method: "PATCH", body: JSON.stringify(validBody) }),
          context
        )
      )!.status
    ).toBe(403);
    expect(getMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps an unknown update to 404", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    getMock.mockRejectedValue(new ProductUpdateActionError("Product update not found.", 404));

    const response = await GET(new Request("http://localhost"), context);
    expect(response!.status).toBe(404);
  });

  it("lets an admin edit copy and maps archived read-only conflicts to 409", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    updateMock.mockResolvedValueOnce({ id: "update-1", status: "PUBLISHED" });

    const ok = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify(validBody) }),
      context
    );
    expect(ok!.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("update-1", expect.objectContaining({ title: validBody.title }), admin, expect.any(Request));

    updateMock.mockRejectedValueOnce(new ProductUpdateActionError("Archived product updates are read-only."));
    const conflict = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify(validBody) }),
      context
    );
    expect(conflict!.status).toBe(409);
  });
});
