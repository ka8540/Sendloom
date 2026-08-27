import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUserMock, listMock } = vi.hoisted(() => ({
  requireApiUserMock: vi.fn(),
  listMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: requireApiUserMock }));
vi.mock("@/services/product-updates", () => ({ listPublishedProductUpdates: listMock }));

import { GET } from "@/app/api/product-updates/route";

const user = { id: "user-1", email: "user@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("user product-updates feed", () => {
  it("requires an authenticated user", async () => {
    requireApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 401 }) });

    const response = await GET(new Request("http://localhost/api/product-updates"));
    expect(response!.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("serves the published-only feed scoped to the session user", async () => {
    requireApiUserMock.mockResolvedValue({ user });
    listMock.mockResolvedValue({
      items: [
        { id: "u2", title: "Newer", publishedAt: "2026-08-26T00:00:00.000Z", seen: false },
        { id: "u1", title: "Older", publishedAt: "2026-08-20T00:00:00.000Z", seen: true }
      ],
      nextCursor: null
    });

    const response = await GET(new Request("http://localhost/api/product-updates"));

    expect(response!.status).toBe(200);
    // The service only ever returns PUBLISHED rows; drafts/archived cannot leak here.
    expect(listMock).toHaveBeenCalledWith("user-1", { cursor: undefined, limit: undefined });
    const body = await response!.json();
    expect(body.items[0].publishedAt > body.items[1].publishedAt).toBe(true);
  });

  it("rejects invalid pagination", async () => {
    requireApiUserMock.mockResolvedValue({ user });

    const response = await GET(new Request("http://localhost/api/product-updates?limit=999"));
    expect(response!.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });
});
