import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const { processPendingCampaignWorkMock, syncConnectedSenderRepliesMock, runAutomaticSequenceBounceChecksMock, mockEnv } =
  vi.hoisted(() => ({
    processPendingCampaignWorkMock: vi.fn(),
    syncConnectedSenderRepliesMock: vi.fn(),
    runAutomaticSequenceBounceChecksMock: vi.fn(),
    mockEnv: {} as Record<string, unknown>
  }));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/services/campaigns", () => ({
  processPendingCampaignWork: processPendingCampaignWorkMock
}));
vi.mock("@/services/replies", () => ({
  syncConnectedSenderReplies: syncConnectedSenderRepliesMock
}));
vi.mock("@/services/sequence-bounce-monitor", () => ({
  runAutomaticSequenceBounceChecks: runAutomaticSequenceBounceChecksMock
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
    runAutomaticSequenceBounceChecksMock.mockReset();
    runAutomaticSequenceBounceChecksMock.mockResolvedValue({
      runsConsidered: 0,
      checksStarted: 0,
      skippedByCadence: 0,
      deferred: 0,
      invalidRecipientsUpdated: 0,
      suppressionsCreated: 0,
      gmailMissingEntitiesSkipped: 0,
      checkFailures: 0
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

  it("runs automatic sequence bounce monitoring on every authorized tick — no browser or button involved", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const res = await POST(makeRequest({ authorization: "Bearer right-secret" }));
    expect(res.status).toBe(200);
    expect(runAutomaticSequenceBounceChecksMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.bounceMonitor).toMatchObject({ checksStarted: 0 });
  });

  it("never blocks the cron response when bounce monitoring fails", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    runAutomaticSequenceBounceChecksMock.mockRejectedValue(new Error("Gmail outage"));
    const res = await POST(makeRequest({ authorization: "Bearer right-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toContainEqual(
      expect.objectContaining({ scope: "sequence-bounce-monitor" })
    );
  });

  it("does not run bounce monitoring for unauthorized callers", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    const res = await POST(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(runAutomaticSequenceBounceChecksMock).not.toHaveBeenCalled();
  });
});
