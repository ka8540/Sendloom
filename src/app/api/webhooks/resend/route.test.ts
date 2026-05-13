import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processProviderEvent: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  env: {
    RESEND_WEBHOOK_SECRET: "webhook-secret"
  }
}));

vi.mock("@/services/campaigns", () => ({
  processProviderEvent: mocks.processProviderEvent
}));

import { POST } from "@/app/api/webhooks/resend/route";

describe("resend webhook route", () => {
  beforeEach(() => {
    mocks.processProviderEvent.mockReset();
  });

  it("returns 401 for a bad signature instead of throwing", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/webhooks/resend", {
        method: "POST",
        headers: {
          "x-resend-signature": "short"
        },
        body: JSON.stringify({
          type: "email.opened",
          data: {
            email_id: "message_1"
          }
        })
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.processProviderEvent).not.toHaveBeenCalled();
  });
});
