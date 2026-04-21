import { describe, expect, it } from "vitest";

import { getSendWindowKey } from "@/lib/rate-limit";

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
});
