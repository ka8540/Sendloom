import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUserMock, markSeenMock } = vi.hoisted(() => ({
  requireApiUserMock: vi.fn(),
  markSeenMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: requireApiUserMock }));
vi.mock("@/services/product-updates", () => ({ markProductUpdatesSeen: markSeenMock }));

import { POST } from "@/app/api/product-updates/seen/route";

const user = { id: "user-1", email: "user@example.com" };

function seenRequest(body: unknown) {
  return new Request("http://localhost/api/product-updates/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mark product updates seen", () => {
  it("requires an authenticated user", async () => {
    requireApiUserMock.mockResolvedValue({ response: new Response("blocked", { status: 401 }) });

    const response = await POST(seenRequest({ ids: ["u1"] }));
    expect(response!.status).toBe(401);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("marks ids seen for the session user and returns the fresh unseen count", async () => {
    requireApiUserMock.mockResolvedValue({ user });
    markSeenMock.mockResolvedValue({ unseenCount: 0 });

    const response = await POST(seenRequest({ ids: ["u1", "u2"] }));

    expect(response!.status).toBe(200);
    expect(markSeenMock).toHaveBeenCalledWith("user-1", ["u1", "u2"]);
    expect(await response!.json()).toEqual({ unseenCount: 0 });
  });

  it("ignores a client-supplied userId — user A cannot mark seen for user B", async () => {
    requireApiUserMock.mockResolvedValue({ user });

    const response = await POST(seenRequest({ ids: ["u1"], userId: "user-2" }));

    expect(response!.status).toBe(400);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("validates the ids payload", async () => {
    requireApiUserMock.mockResolvedValue({ user });

    expect((await POST(seenRequest({ ids: [] })))!.status).toBe(400);
    expect((await POST(seenRequest({})))!.status).toBe(400);
    expect(markSeenMock).not.toHaveBeenCalled();
  });
});
