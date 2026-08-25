import { beforeEach, describe, expect, it, vi } from "vitest";

const { processorMock, mockEnv } = vi.hoisted(() => ({
  processorMock: vi.fn(),
  mockEnv: {} as { CRON_SECRET?: string }
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/system-notice-notifications", () => ({ processSystemNotices: processorMock }));

import { GET, POST } from "./route";

function request(headers: Record<string, string> = {}) {
  return new Request("https://sendloom.net/api/cron/system-notices", { headers });
}

describe("system notice cron authorization", () => {
  beforeEach(() => {
    delete mockEnv.CRON_SECRET;
    processorMock.mockReset();
    processorMock.mockResolvedValue({
      noticesDue: 0,
      noticesStarted: 0,
      noticesCompleted: 0,
      recipientsMaterialized: 0,
      recipientsSent: 0,
      recipientsRemaining: 0,
      failures: 0,
      deliveryEnabled: false
    });
  });

  it("fails closed when CRON_SECRET is absent or incorrect", async () => {
    expect((await GET(request())).status).toBe(401);
    mockEnv.CRON_SECRET = "right-secret";
    expect((await POST(request({ authorization: "Bearer wrong-secret" }))).status).toBe(401);
    expect(processorMock).not.toHaveBeenCalled();
  });

  it("accepts the existing bearer and explicit secret-header conventions", async () => {
    mockEnv.CRON_SECRET = "right-secret";
    expect((await GET(request({ authorization: "Bearer right-secret" }))).status).toBe(200);
    expect((await POST(request({ "x-cron-secret": "right-secret" }))).status).toBe(200);
    expect(processorMock).toHaveBeenCalledTimes(2);
  });
});
