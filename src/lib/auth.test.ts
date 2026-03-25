import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    }
  }
}));

vi.mock("@/lib/env", () => ({
  env: {
    SESSION_SECRET: "test-session-secret"
  }
}));

import { SESSION_DURATION_SECONDS, createSessionToken, verifySessionToken } from "@/lib/auth";

describe("auth session tokens", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates tokens that last 30 days", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const claims = verifySessionToken(createSessionToken("owner@example.com"));

    expect(claims?.email).toBe("owner@example.com");
    expect(claims?.exp).toBe(Math.floor(now.getTime() / 1000) + SESSION_DURATION_SECONDS);
  });

  it("rejects malformed tokens", () => {
    expect(verifySessionToken("not-a-real-token")).toBeNull();
  });
});
