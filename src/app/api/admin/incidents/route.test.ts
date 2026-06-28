import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApiUserMock, listAdminIncidentsMock, rateLimitMock } = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  listAdminIncidentsMock: vi.fn(),
  rateLimitMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/incident-reports", () => ({
  listAdminIncidents: listAdminIncidentsMock,
  INCIDENT_STATUSES: ["NEW", "INVESTIGATING", "RESOLVED", "IGNORED"]
}));

import { GET } from "@/app/api/admin/incidents/route";

// Next types route handlers as possibly returning undefined; this route always
// returns a Response at runtime, so narrow it for the assertions below.
async function callGet(url: string) {
  const res = await GET(new Request(url));
  if (!res) {
    throw new Error("Expected the incidents route to return a response.");
  }
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("GET /api/admin/incidents (admin authorization)", () => {
  it("blocks a non-admin request and never queries incidents", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("forbidden", { status: 403 }) });

    const response = await callGet("http://localhost/api/admin/incidents");

    expect(response.status).toBe(403);
    expect(listAdminIncidentsMock).not.toHaveBeenCalled();
  });

  it("returns the safe incident list for an admin", async () => {
    requireAdminApiUserMock.mockResolvedValue({ user: { id: "admin_1", email: "admin@example.com" } });
    listAdminIncidentsMock.mockResolvedValue({ items: [{ reportId: "INC-1" }], nextCursor: null, totalCount: 1 });

    const response = await callGet("http://localhost/api/admin/incidents?status=NEW&severity=HIGH");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ reportId: string }> };
    expect(body.items[0].reportId).toBe("INC-1");
    expect(listAdminIncidentsMock).toHaveBeenCalledTimes(1);
  });
});
