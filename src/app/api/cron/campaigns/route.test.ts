import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const { processPendingCampaignWorkMock, syncConnectedSenderRepliesMock, mockEnv } = vi.hoisted(() => ({
  processPendingCampaignWorkMock: vi.fn(),
  syncConnectedSenderRepliesMock: vi.fn(),
  mockEnv: {} as Record<string, unknown>
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/services/campaigns", () => ({
  processPendingCampaignWork: processPendingCampaignWorkMock
}));
vi.mock("@/services/replies", () => ({
  syncConnectedSenderReplies: syncConnectedSenderRepliesMock
}));

import { GET, POST } from "./route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/cron/campaigns", { method: "GET", headers });
}

describe("/api/cron/campaigns authorization", () => {
  beforeEach(() => {
    processPendingCampaignWorkMock.mockResolvedValue({
      dueCampaignsFound: 0,
      runsCreated: 0,
      runsProcessed: 0,
      recipientJobsProcessed: 0,
      hasRemainingWork: false,
      errors: []
    });
    syncConnectedSenderRepliesMock.mockResolvedValue({
      repliesStored: 0,
      sendersChecked: 0,
      sendersFailed: 0
    });
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when CRON_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(processPendingCampaignWorkMock).not.toHaveBeenCalled();
  });

  it("rejects bad bearer secrets even outside production", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const res = await POST(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("accepts the correct bearer secret", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const res = await POST(makeRequest({ authorization: "Bearer right-secret" }));
    expect(res.status).toBe(200);
    expect(processPendingCampaignWorkMock).toHaveBeenCalled();
  });

  it("accepts the correct x-cron-secret header", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const res = await POST(makeRequest({ "x-cron-secret": "right-secret" }));
    expect(res.status).toBe(200);
  });

  it("allows unauthenticated calls in non-production when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });
});
