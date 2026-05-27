import { describe, expect, it } from "vitest";

import { getClientIp, getSendWindowKey, getSendWindowSpacingMs } from "@/lib/rate-limit";

describe("send window keys", () => {
  it("scopes the send window by user id when present", () => {
    expect(getSendWindowKey({ userId: "user_123", senderProfileId: "sender_123" })).toBe("user-send-window:user_123");
  });

  it("falls back to the sender profile when the user id is missing", () => {
    expect(getSendWindowKey({ senderProfileId: "sender_123" })).toBe("sender-send-window:sender_123");
  });

  it("keeps the legacy global bucket when no owner information is available", () => {
    expect(getSendWindowKey()).toBe("global-send-window");
  });

  it("derives smooth per-send pacing from the per-minute cap", () => {
    expect(getSendWindowSpacingMs(120)).toBe(500);
    expect(getSendWindowSpacingMs(60)).toBe(1000);
  });
});

describe("getClientIp", () => {
  function makeRequest(headers: Record<string, string>) {
    return new Request("https://example.com", { headers });
  }

  it("returns the first entry from x-forwarded-for", () => {
    expect(getClientIp(makeRequest({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }))).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip when no forwarded header is present", () => {
    expect(getClientIp(makeRequest({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("returns 'unknown' when neither header is set", () => {
    expect(getClientIp(makeRequest({}))).toBe("unknown");
  });
});
