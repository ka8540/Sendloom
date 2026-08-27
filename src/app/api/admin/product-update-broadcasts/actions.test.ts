import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdminApiUserMock,
  rateLimitMock,
  getMock,
  updateMock,
  sendNowMock,
  scheduleMock,
  cancelMock
} = vi.hoisted(() => ({
  requireAdminApiUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  getMock: vi.fn(),
  updateMock: vi.fn(),
  sendNowMock: vi.fn(),
  scheduleMock: vi.fn(),
  cancelMock: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireAdminApiUser: requireAdminApiUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  createRateLimitResponse: () => new Response("rate limited", { status: 429 })
}));
vi.mock("@/services/product-update-broadcasts", () => ({
  getProductUpdateBroadcast: getMock,
  updateProductUpdateBroadcast: updateMock,
  requestProductUpdateSendNow: sendNowMock,
  scheduleProductUpdateBroadcast: scheduleMock,
  cancelProductUpdateBroadcast: cancelMock
}));

import { GET, PATCH } from "@/app/api/admin/product-update-broadcasts/[id]/route";
import { POST as SEND_NOW } from "@/app/api/admin/product-update-broadcasts/[id]/send-now/route";
import { POST as SCHEDULE } from "@/app/api/admin/product-update-broadcasts/[id]/schedule/route";
import { POST as CANCEL } from "@/app/api/admin/product-update-broadcasts/[id]/cancel/route";

const admin = { id: "admin-1", email: "admin@example.com" };
const context = { params: Promise.resolve({ id: "broadcast-1" }) };
const valid = {
  subject: "New in Sendloom",
  headline: "Better workflows",
  intro: "We shipped an improvement.",
  features: [{ title: "Notifications", description: "Stay informed.", ctaLabel: null, ctaHref: null }],
  scheduledSendAt: null,
  timeZone: "America/Phoenix"
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminApiUserMock.mockResolvedValue({ user: admin });
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

describe("admin product update action APIs", () => {
  it("reads and edits a validated draft", async () => {
    getMock.mockResolvedValue({ id: "broadcast-1", status: "DRAFT" });
    expect((await GET(new Request("http://localhost/detail"), context))!.status).toBe(200);

    updateMock.mockResolvedValue({ id: "broadcast-1", status: "DRAFT", headline: valid.headline });
    const response = await PATCH(new Request("http://localhost/detail", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid)
    }), context);
    expect(response!.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("broadcast-1", expect.objectContaining({ headline: valid.headline }), admin, expect.any(Request));
  });

  it("requires the exact typed all-user phrase before send now", async () => {
    const invalid = await SEND_NOW(new Request("http://localhost/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "SEND" })
    }), context);
    expect(invalid!.status).toBe(400);
    expect(sendNowMock).not.toHaveBeenCalled();

    sendNowMock.mockResolvedValue({ id: "broadcast-1", status: "SCHEDULED" });
    const validResponse = await SEND_NOW(new Request("http://localhost/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "SEND TO ALL USERS" })
    }), context);
    expect(validResponse!.status).toBe(200);
    expect(sendNowMock).toHaveBeenCalledWith("broadcast-1", admin, expect.any(Request));
  });

  it("schedules a UTC instant with its IANA timezone and can cancel before delivery", async () => {
    scheduleMock.mockResolvedValue({ id: "broadcast-1", status: "SCHEDULED" });
    const response = await SCHEDULE(new Request("http://localhost/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledSendAt: "2027-08-27T05:00:00.000Z", timeZone: "America/Phoenix" })
    }), context);
    expect(response!.status).toBe(200);
    expect(scheduleMock).toHaveBeenCalledWith(
      "broadcast-1",
      new Date("2027-08-27T05:00:00.000Z"),
      "America/Phoenix",
      admin,
      expect.any(Request)
    );

    cancelMock.mockResolvedValue({ id: "broadcast-1", status: "CANCELLED" });
    expect((await CANCEL(new Request("http://localhost/cancel", { method: "POST" }), context))!.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith("broadcast-1", admin, expect.any(Request));
  });

  it("blocks non-admin action access before service calls", async () => {
    requireAdminApiUserMock.mockResolvedValue({ response: new Response("forbidden", { status: 403 }) });
    expect((await CANCEL(new Request("http://localhost/cancel", { method: "POST" }), context))!.status).toBe(403);
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
