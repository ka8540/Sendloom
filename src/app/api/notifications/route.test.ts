import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class InvalidNotificationCursorError extends Error {}
  return {
    requireApiUser: vi.fn(),
    listNotificationsForUser: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    InvalidNotificationCursorError
  };
});

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/notifications", () => ({
  InvalidNotificationCursorError: mocks.InvalidNotificationCursorError,
  listNotificationsForUser: mocks.listNotificationsForUser,
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead
}));

import { GET } from "@/app/api/notifications/route";
import { POST as markRead } from "@/app/api/notifications/[id]/read/route";
import { POST as markAllRead } from "@/app/api/notifications/read-all/route";

beforeEach(() => {
  vi.clearAllMocks();
});

function requireResponse(response: Response | undefined) {
  expect(response).toBeDefined();
  if (!response) {
    throw new Error("Expected the route to return a response.");
  }
  return response;
}

describe("notification API authorization", () => {
  it("blocks unauthenticated list requests before querying notifications", async () => {
    mocks.requireApiUser.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });

    const response = requireResponse(await GET(new Request("http://localhost/api/notifications")));

    expect(response.status).toBe(401);
    expect(mocks.listNotificationsForUser).not.toHaveBeenCalled();
  });

  it("lists only through the authenticated user id with bounded cursor pagination", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { id: "user_a" } });
    mocks.listNotificationsForUser.mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });

    const response = requireResponse(
      await GET(new Request("http://localhost/api/notifications?limit=10&cursor=opaque"))
    );

    expect(response.status).toBe(200);
    expect(mocks.listNotificationsForUser).toHaveBeenCalledWith("user_a", { limit: 10, cursor: "opaque" });
  });

  it("rejects invalid pagination before querying the database", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { id: "user_a" } });

    const response = requireResponse(
      await GET(new Request("http://localhost/api/notifications?limit=5000"))
    );

    expect(response.status).toBe(400);
    expect(mocks.listNotificationsForUser).not.toHaveBeenCalled();
  });

  it("passes the authenticated owner to mark-one and returns not-found for a non-owned id", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { id: "user_a" } });
    mocks.markNotificationRead.mockResolvedValue(false);

    const response = requireResponse(
      await markRead(new Request("http://localhost", { method: "POST" }), {
        params: Promise.resolve({ id: "notification_b" })
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.markNotificationRead).toHaveBeenCalledWith("user_a", "notification_b");
  });

  it("marks all through the authenticated owner only", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { id: "user_a" } });
    mocks.markAllNotificationsRead.mockResolvedValue(3);

    const response = requireResponse(await markAllRead());
    const body = (await response.json()) as { updatedCount: number };

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(3);
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith("user_a");
  });
});
