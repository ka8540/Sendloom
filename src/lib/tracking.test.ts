import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    SESSION_SECRET: "test-session-secret",
    TRACKING_SECRET: "test-tracking-secret",
    APP_BASE_URL: "https://app.example.com"
  }
}));

import { createSessionToken, verifySessionToken } from "@/lib/auth";
import { InvalidTrackingTokenError, signTrackingToken, verifyTrackingToken } from "@/lib/tracking";

describe("tracking vs session token separation", () => {
  it("verifies tracking tokens with the correct channel", () => {
    const token = signTrackingToken({ type: "open", jobId: "job-1", email: "alice@example.com" });
    const claims = verifyTrackingToken(token, "open");
    expect(claims.type).toBe("open");
    expect(claims.email).toBe("alice@example.com");
  });

  it("rejects tracking tokens used at the wrong channel", () => {
    const token = signTrackingToken({ type: "open", jobId: "job-1", email: "alice@example.com" });
    expect(() => verifyTrackingToken(token, "click")).toThrow(InvalidTrackingTokenError);
    expect(() => verifyTrackingToken(token, "unsubscribe")).toThrow(InvalidTrackingTokenError);
  });

  it("rejects malformed tracking tokens", () => {
    expect(() => verifyTrackingToken("not-a-jwt")).toThrow(InvalidTrackingTokenError);
  });

  it("session tokens cannot be used as tracking tokens", () => {
    const sessionToken = createSessionToken("alice@example.com");
    expect(() => verifyTrackingToken(sessionToken)).toThrow(InvalidTrackingTokenError);
  });

  it("tracking tokens cannot be used as session tokens", () => {
    const trackingToken = signTrackingToken({
      type: "open",
      jobId: "job-1",
      email: "alice@example.com"
    });
    expect(verifySessionToken(trackingToken)).toBeNull();
  });
});
