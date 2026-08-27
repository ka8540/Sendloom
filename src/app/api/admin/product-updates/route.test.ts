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
vi.mock("@/services/product-updates", () => ({
  listAdminProductUpdates: listMock,
  createProductUpdate: createMock
}));

import { GET, POST } from "@/app/api/admin/product-updates/route";

const admin = { id: "admin-1", email: "admin@example.com" };

const validBody = {
  title: "Stay updated with in-app notifications",
  summary: "Important Sendloom updates now arrive directly in your workspace.",
  description: "Sendloom can now notify you when a Discover search finishes.",
  icon: "BELL",
  ctaLabel: "Open dashboard",
  ctaHref: "/workspace"
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/admin/product-updates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("admin product-updates API authorization", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "non-admin"]
  ])("returns %s for an %s request without touching product update data", async (status) => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("blocked", { status }) });

    const listResponse = await GET(new Request("http://localhost/api/admin/product-updates"));
    const createResponse = await POST(postRequest(validBody));

    expect(listResponse!.status).toBe(status);
    expect(createResponse!.status).toBe(status);
    expect(listMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("admin product-updates list", () => {
  it("returns the bounded list with summary metrics", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    listMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      summary: { drafts: 1, published: 2, archived: 3, totalViews: 42 }
    });

    const response = await GET(new Request("http://localhost/api/admin/product-updates"));

    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ summary: { drafts: 1, published: 2, archived: 3, totalViews: 42 } });
  });

  it("rejects an invalid cursor", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });

    const response = await GET(new Request(`http://localhost/api/admin/product-updates?cursor=${"x".repeat(65)}`));
    expect(response!.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("admin product-updates create", () => {
  it("lets an admin create a draft", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });
    createMock.mockResolvedValue({ id: "update-1", status: "DRAFT" });

    const response = await POST(postRequest(validBody));

    expect(response!.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: validBody.title, ctaHref: "/workspace" }),
      admin,
      expect.any(Request)
    );
  });

  it("rejects invalid content before touching the service", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });

    const response = await POST(postRequest({ ...validBody, title: " ", description: "" }));

    expect(response!.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an external CTA destination", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });

    const response = await POST(postRequest({ ...validBody, ctaHref: "https://evil.com/phish" }));

    expect(response!.status).toBe(400);
    expect(await response!.json()).toMatchObject({ error: expect.stringContaining("inside Sendloom") });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: admin });

    const response = await POST(
      new Request("http://localhost/api/admin/product-updates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json"
      })
    );

    expect(response!.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
