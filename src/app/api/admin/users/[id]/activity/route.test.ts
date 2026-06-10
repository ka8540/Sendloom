import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, rateLimitMock, listUserActivityEventsMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  listUserActivityEventsMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdminApiUser: requireAdminApiUserMock
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: vi.fn(
    () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })
  )
}));

vi.mock("@/services/admin-activity", () => ({
  listUserActivityEvents: listUserActivityEventsMock
}));

import { GET } from "./route";

const params = Promise.resolve({ id: "user_1" });

function buildRequest(query = "") {
  return new Request(`https://sendloom.test/api/admin/users/user_1/activity${query}`);
}

// The handler's inferred type includes `undefined` (an artifact of the
// `requireAdminApiUser` union), so unwrap once here for clean assertions.
async function callGet(query = "") {
  const response = await GET(buildRequest(query), { params });
  if (!response) {
    throw new Error("Handler returned no response.");
  }
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminApiUserMock.mockResolvedValue({ user: { id: "admin_1", email: "admin@example.com" } });
  rateLimitMock.mockResolvedValue({ allowed: true });
  listUserActivityEventsMock.mockResolvedValue({ events: [], nextCursor: null });
});

describe("GET /api/admin/users/[id]/activity", () => {
  it("returns the auth failure response for non-admin callers", async () => {
    requireAdminApiUserMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ error: "Admin access is required." }), { status: 403 })
    });

    const response = await callGet();

    expect(response.status).toBe(403);
    expect(listUserActivityEventsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid filter values", async () => {
    const response = await callGet("?category=NOT_A_CATEGORY");

    expect(response.status).toBe(400);
    expect(listUserActivityEventsMock).not.toHaveBeenCalled();
  });

  it("passes validated filters to the service", async () => {
    const response = await callGet("?category=SEQUENCE&severity=ERROR&type=import&q=blackrock&cursor=audit_9");

    expect(response.status).toBe(200);
    expect(listUserActivityEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        category: "SEQUENCE",
        severity: "ERROR",
        targetType: "import",
        search: "blackrock",
        cursor: "audit_9"
      })
    );
  });

  it("returns 404 when the target user does not exist", async () => {
    listUserActivityEventsMock.mockResolvedValueOnce(null);

    const response = await callGet();

    expect(response.status).toBe(404);
  });

  it("returns the events payload for admins", async () => {
    listUserActivityEventsMock.mockResolvedValueOnce({
      events: [{ id: "audit_1", action: "auth.login" }],
      nextCursor: "audit_1"
    });

    const response = await callGet();
    const body = (await response.json()) as { events: Array<{ id: string }>; nextCursor: string };

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.nextCursor).toBe("audit_1");
  });
});
