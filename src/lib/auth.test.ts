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
      findUnique: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

vi.mock("@/lib/env", () => ({
  env: {
    SESSION_SECRET: "test-session-secret",
    TRACKING_SECRET: "test-tracking-secret",
    APP_BASE_URL: "https://app.example.com"
  }
}));

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import {
  SESSION_DURATION_SECONDS,
  createPasswordHash,
  createSessionToken,
  normalizeUserEmail,
  redirectAuthenticatedToWorkspace,
  verifyPassword,
  verifySessionToken
} from "@/lib/auth";

const cookiesMock = vi.mocked(cookies);
const redirectMock = vi.mocked(redirect);
const findUniqueMock = vi.mocked(prisma.user.findUnique);
const updateManyMock = vi.mocked(prisma.user.updateMany);

// Wire the mocked cookie store so `getSession()` reads back the given token.
function setSessionCookie(token: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name && token ? { value: token } : undefined)
  } as never);
}

// Minimal DB row shape `getSession()` selects for a valid, fresh session.
function validSessionUser(email: string, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    email,
    eligibilityBlockedAt: null,
    sessionExpiresAt: new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000),
    sessionIssuedAt: new Date(now.getTime() - 60_000),
    lastSeenAt: now,
    ...overrides
  };
}

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

  it("normalizes mixed-case emails before storing them in session state", () => {
    expect(normalizeUserEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });
});

describe("password hashing", () => {
  it("stores a bcrypt hash that accepts only the replacement password", async () => {
    const oldPassword = "old-password-value";
    const newPassword = "new-password-value";
    const replacementHash = await createPasswordHash(newPassword);

    expect(replacementHash).toMatch(/^\$2[aby]\$12\$/);
    expect(replacementHash).not.toContain(newPassword);
    expect(await verifyPassword(oldPassword, replacementHash)).toBe(false);
    expect(await verifyPassword(newPassword, replacementHash)).toBe(true);
  });
});

describe("redirectAuthenticatedToWorkspace", () => {
  beforeEach(() => {
    vi.useRealTimers();
    redirectMock.mockReset();
    findUniqueMock.mockReset();
    updateManyMock.mockReset();
    updateManyMock.mockResolvedValue({ count: 1 } as never);
  });

  it("redirects a visitor with a valid session to /workspace", async () => {
    const email = "owner@example.com";
    setSessionCookie(createSessionToken(email));
    findUniqueMock.mockResolvedValue(validSessionUser(email) as never);

    await redirectAuthenticatedToWorkspace();

    expect(redirectMock).toHaveBeenCalledWith("/workspace");
  });

  it("does not redirect when there is no session cookie", async () => {
    setSessionCookie(undefined);

    await redirectAuthenticatedToWorkspace();

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not redirect on a malformed / forged token", async () => {
    setSessionCookie("not-a-real-token");

    await redirectAuthenticatedToWorkspace();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("treats an expired session as logged out and does not redirect", async () => {
    const email = "owner@example.com";
    setSessionCookie(createSessionToken(email));
    findUniqueMock.mockResolvedValue(
      validSessionUser(email, { sessionExpiresAt: new Date(Date.now() - 60_000) }) as never
    );

    await redirectAuthenticatedToWorkspace();

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("treats a revoked session (token issued before revocation) as logged out", async () => {
    const email = "owner@example.com";
    setSessionCookie(createSessionToken(email));
    findUniqueMock.mockResolvedValue(
      // Session was revoked *after* this token was issued.
      validSessionUser(email, { sessionIssuedAt: new Date(Date.now() + 60_000) }) as never
    );

    await redirectAuthenticatedToWorkspace();

    expect(redirectMock).not.toHaveBeenCalled();
  });
});
