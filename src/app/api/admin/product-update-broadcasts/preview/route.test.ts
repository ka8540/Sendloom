import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, renderMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  renderMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/env", () => ({ env: { APP_BASE_URL: "https://sendloom.net" } }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/lib/product-update-email", () => ({ renderProductUpdateEmail: renderMock }));

import { POST } from "@/app/api/admin/product-update-broadcasts/preview/route";

const body = {
  subject: "New in Sendloom",
  headline: "Better workflows",
  intro: "We shipped an improvement.",
  features: [{ title: "Notifications", description: "Stay informed.", ctaLabel: null, ctaHref: null }],
  scheduledSendAt: null,
  timeZone: "America/Phoenix"
};

describe("product update preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    requireAdminApiUserMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } });
    renderMock.mockReturnValue({ subject: body.subject, html: "<html>exact renderer</html>", text: "exact renderer" });
  });

  it("uses only the exact renderer and does not invoke any recipient or delivery service", async () => {
    const response = await POST(new Request("http://localhost/api/admin/product-update-broadcasts/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }));
    expect(response!.status).toBe(200);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(await response!.json()).toEqual({ subject: body.subject, html: "<html>exact renderer</html>", text: "exact renderer" });
  });

  it("blocks non-admin preview before rendering", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("forbidden", { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/admin/product-update-broadcasts/preview", { method: "POST" }));
    expect(response!.status).toBe(403);
    expect(renderMock).not.toHaveBeenCalled();
  });
});
