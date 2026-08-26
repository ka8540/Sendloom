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
vi.mock("@/lib/system-notice-email", () => ({ renderSystemNoticeEmail: renderMock }));

import { POST } from "@/app/api/admin/system-notices/preview/route";

describe("system notice preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    requireAdminApiUserMock.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.com" } });
    renderMock.mockReturnValue({
      subject: "Sendloom service notice",
      html: "<html>safe preview</html>",
      text: "safe preview",
      typeLabel: "Service notice",
      impactWindow: null
    });
  });

  it("uses the production renderer without a recipient or delivery action", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/system-notices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "GENERAL",
          subject: "Sendloom service notice",
          title: "Service update",
          message: "An operational update.",
          affectedArea: null,
          scheduledSendAt: null,
          impactStartsAt: null,
          impactEndsAt: null,
          timeZone: "America/Phoenix"
        })
      })
    );
    expect(response!.status).toBe(200);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(await response!.json()).toMatchObject({ html: "<html>safe preview</html>", subject: "Sendloom service notice" });
  });

  it("blocks non-admin preview before rendering", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("forbidden", { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/admin/system-notices/preview", { method: "POST" }));
    expect(response!.status).toBe(403);
    expect(renderMock).not.toHaveBeenCalled();
  });
});
