import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    APP_BASE_URL: "https://app.example.com",
    SESSION_SECRET: "test-session-secret"
  }
}));

import { safeVerifyTrackingToken, signTrackingToken } from "@/lib/tracking";

describe("tracking tokens", () => {
  it("returns null for malformed tokens", () => {
    expect(safeVerifyTrackingToken("not-a-token")).toBeNull();
  });

  it("preserves the signed tracking type for route-level checks", () => {
    const token = signTrackingToken({
      type: "click",
      jobId: "job_1",
      email: "recipient@example.com",
      target: "https://example.com"
    });

    expect(safeVerifyTrackingToken(token)?.type).toBe("click");
  });
});
