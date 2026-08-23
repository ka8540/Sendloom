import { beforeEach, describe, expect, it, vi } from "vitest";

const { processorMock, mockEnv } = vi.hoisted(() => ({
  processorMock: vi.fn(),
  mockEnv: {} as { CRON_SECRET?: string }
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/legal-policy-notifications", () => ({ processLegalPolicyNotices: processorMock }));

import { GET, POST } from "./route";

function request(headers: Record<string, string> = {}) {
  return new Request("https://sendloom.net/api/cron/legal-policy-notices", { headers });
}

describe("legal policy notice cron authorization", () => {
  beforeEach(() => {
    delete mockEnv.CRON_SECRET;
    processorMock.mockReset();
    processorMock.mockResolvedValue({
      detectedPolicies: 3,
      baselinesCreated: 0,
      noticesCreated: 0,
      noticesStarted: 0,
      noticesCompleted: 0,
      recipientsMaterialized: 0,
      recipientsSent: 0,
      recipientsRemaining: 0,
      failures: 0,
      deliveryEnabled: false
    });
  });

  it("fails closed when CRON_SECRET is missing in every environment", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(processorMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid secret", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const response = await POST(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
    expect(processorMock).not.toHaveBeenCalled();
  });

  it("accepts Vercel bearer and explicit cron headers without exposing recipients", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const bearer = await GET(request({ authorization: "Bearer right-secret" }));
    expect(bearer.status).toBe(200);
    expect(await bearer.json()).not.toHaveProperty("recipients");

    const explicit = await POST(request({ "x-cron-secret": "right-secret" }));
    expect(explicit.status).toBe(200);
    expect(processorMock).toHaveBeenCalledTimes(2);
  });
});
