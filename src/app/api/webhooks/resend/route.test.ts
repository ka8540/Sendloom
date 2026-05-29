import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { processProviderEventMock, mockEnv } = vi.hoisted(() => ({
  processProviderEventMock: vi.fn(),
  mockEnv: {} as Record<string, unknown>
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/services/campaigns", () => ({
  processProviderEvent: processProviderEventMock
}));

import { POST } from "./route";

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/webhooks/resend", {
    method: "POST",
    body,
    headers
  });
}

describe("/api/webhooks/resend", () => {
  beforeEach(() => {
    processProviderEventMock.mockReset();
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    mockEnv.RESEND_WEBHOOK_SECRET = "test-secret";
  });

  it("rejects malformed signatures without crashing", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });
    const res = await POST(makeRequest(body, { "x-resend-signature": "not-hex" }));
    expect(res.status).toBe(401);
    expect(processProviderEventMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched-length signatures without throwing", async () => {
    const body = "{}";
    const res = await POST(makeRequest(body, { "x-resend-signature": "ab" }));
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed payload and dispatches the event", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-1" } });
    const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
    const res = await POST(makeRequest(body, { "x-resend-signature": signature }));
    expect(res.status).toBe(200);
    expect(processProviderEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "resend",
        providerMessageId: "msg-1",
        eventType: "DELIVERED"
      })
    );
  });

  it("returns 400 on malformed JSON body even with valid signature", async () => {
    const body = "not json";
    const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
    const res = await POST(makeRequest(body, { "x-resend-signature": signature }));
    expect(res.status).toBe(400);
    expect(processProviderEventMock).not.toHaveBeenCalled();
  });
});
