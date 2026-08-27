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
vi.mock("@/services/product-update-broadcasts", () => ({
  listProductUpdateBroadcasts: listMock,
  createProductUpdateBroadcast: createMock
}));

import { GET, POST } from "@/app/api/admin/product-update-broadcasts/route";

const admin = { id: "admin-1", email: "admin@example.com" };
const valid = {
  subject: "New in Sendloom",
  headline: "Better workflows",
  intro: "We shipped an improvement.",
  features: [{ title: "Notifications", description: "Stay informed.", ctaLabel: "Open Sendloom", ctaHref: "/workspace" }],
  scheduledSendAt: null,
  timeZone: "America/Phoenix"
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("admin product update API", () => {
  it.each([[401], [403]])("blocks non-admin access with %s before data access", async (status) => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status }) });
    expect((await GET(new Request("http://localhost/api/admin/product-update-broadcasts")))!.status).toBe(status);
    expect(listMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("lets an admin list aggregate history and create a validated draft", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    listMock.mockResolvedValue({ broadcasts: [], accountRecipientCount: 4, summary: {} });
    expect(await (await GET(new Request("http://localhost/api/admin/product-update-broadcasts")))!.json())
      .toMatchObject({ accountRecipientCount: 4, broadcasts: [] });

    createMock.mockResolvedValue({ id: "broadcast-1", status: "DRAFT" });
    const created = await POST(new Request("http://localhost/api/admin/product-update-broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid)
    }));
    expect(created!.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ features: valid.features }), admin, expect.any(Request));

    const rejected = await POST(new Request("http://localhost/api/admin/product-update-broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, features: [] })
    }));
    expect(rejected!.status).toBe(400);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
