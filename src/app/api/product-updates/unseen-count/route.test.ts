import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUserMock, countMock } = vi.hoisted(() => ({
  requireApiUserMock: vi.fn(),
  countMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: requireApiUserMock }));
vi.mock("@/services/product-updates", () => ({ countUnseenProductUpdates: countMock }));

import { GET } from "@/app/api/product-updates/unseen-count/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unseen product update count", () => {
  it("requires an authenticated user", async () => {
    requireApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 401 }) });

    expect((await GET())!.status).toBe(401);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("returns the count for the session user", async () => {
    requireApiUserMock.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
    countMock.mockResolvedValue(2);

    const response = await GET();

    expect(response!.status).toBe(200);
    expect(countMock).toHaveBeenCalledWith("user-1");
    expect(await response!.json()).toEqual({ count: 2 });
  });
});
