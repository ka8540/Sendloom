import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  env: {
    SESSION_SECRET: "test-session-secret",
    APP_BASE_URL: "https://app.example.com",
    ADMIN_EMAIL: "admin@example.com"
  }
}));

vi.mock("@/lib/google", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/google")>();
  return {
    ...actual,
    exchangeGoogleCode: vi.fn(),
    fetchGoogleUserInfo: vi.fn()
  };
});

vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSession: vi.fn()
  };
});

import { cookies } from "next/headers";

import { recordAuditEvent } from "@/lib/audit";
import { setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { exchangeGoogleCode, fetchGoogleUserInfo } from "@/lib/google";
import {
  GOOGLE_LOGIN_ACCOUNT_INELIGIBLE_ERROR,
  GOOGLE_LOGIN_UNVERIFIED_EMAIL_ERROR,
  GOOGLE_LOGIN_USER_ERROR
} from "@/lib/user-facing-errors";

import { GET } from "./route";

const cookiesMock = vi.mocked(cookies);
const recordAuditEventMock = vi.mocked(recordAuditEvent);
const setSessionMock = vi.mocked(setSession);
const findUniqueMock = vi.mocked(prisma.user.findUnique);
const createMock = vi.mocked(prisma.user.create);
const updateManyMock = vi.mocked(prisma.user.updateMany);
const exchangeGoogleCodeMock = vi.mocked(exchangeGoogleCode);
const fetchGoogleUserInfoMock = vi.mocked(fetchGoogleUserInfo);

const STATE = "state-123";
const SUB = "google-sub-1";

function callbackUrl(query = `code=code-abc&state=${STATE}`) {
  return `https://app.example.com/api/auth/google/login/callback?${query}`;
}

function primeHappyPath(profile: { email: string; email_verified?: boolean; sub?: string }) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name ? { value: STATE } : undefined),
    delete: vi.fn()
  } as never);
  exchangeGoogleCodeMock.mockResolvedValue({ access_token: "token" } as never);
  fetchGoogleUserInfoMock.mockResolvedValue({ sub: SUB, email_verified: true, ...profile } as never);
}

function redirectError(response: Response) {
  return new URL(response.headers.get("location") ?? "").searchParams.get("error");
}

function auditActions() {
  return recordAuditEventMock.mock.calls.map(([args]) => args.action);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Google login callback", () => {
  it("rejects a mismatched OAuth state without touching Google or the DB", async () => {
    cookiesMock.mockResolvedValue({
      get: () => ({ value: "other-state" }),
      delete: vi.fn()
    } as never);

    const response = await GET(new Request(callbackUrl()));

    expect(redirectError(response)).toBe(GOOGLE_LOGIN_USER_ERROR);
    expect(exchangeGoogleCodeMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects an unverified Google email", async () => {
    primeHappyPath({ email: "user@gmail.com", email_verified: false });

    const response = await GET(new Request(callbackUrl()));

    expect(redirectError(response)).toBe(GOOGLE_LOGIN_UNVERIFIED_EMAIL_ERROR);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("links a verified Google identity to the existing password account and signs in", async () => {
    primeHappyPath({ email: "User@Gmail.com" });
    const existing = {
      id: "user-1",
      email: "user@gmail.com",
      passwordHash: "hashed-value",
      googleSub: null,
      isAdmin: false,
      eligibilityBlockedAt: null
    };
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(existing as never);
    updateManyMock.mockResolvedValue({ count: 1 } as never);

    const response = await GET(new Request(callbackUrl()));

    // Only the Google identity is written — the password hash is untouched.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1", googleSub: null },
      data: { googleSub: SUB }
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(setSessionMock).toHaveBeenCalledWith("user@gmail.com");
    expect(auditActions()).toEqual(["auth.google_identity_linked", "auth.google_login"]);
    expect(response.headers.get("location")).toBe("https://app.example.com/workspace");
  });

  it("signs in an already-linked user by Google subject, password or not", async () => {
    primeHappyPath({ email: "admin@example.com" });
    const linked = {
      id: "user-1",
      email: "admin@example.com",
      passwordHash: "hashed-value",
      googleSub: SUB,
      isAdmin: true,
      eligibilityBlockedAt: null
    };
    findUniqueMock.mockResolvedValueOnce(linked as never);

    const response = await GET(new Request(callbackUrl()));

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["auth.google_login"]);
    expect(response.headers.get("location")).toBe("https://app.example.com/admin");
  });

  it("creates exactly one user for a brand-new Google identity", async () => {
    primeHappyPath({ email: "new@gmail.com" });
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "user-2", email: "new@gmail.com", isAdmin: false } as never);

    const response = await GET(new Request(callbackUrl()));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({ data: { email: "new@gmail.com", googleSub: SUB } });
    expect(auditActions()).toEqual(["auth.google_signup"]);
    expect(response.headers.get("location")).toBe("https://app.example.com/workspace");
  });

  it("fails closed when the Google identity belongs to a different user", async () => {
    primeHappyPath({ email: "user@gmail.com" });
    const existing = { id: "user-1", email: "user@gmail.com", passwordHash: "hashed-value", googleSub: null };
    findUniqueMock
      .mockResolvedValueOnce(null) // no user for this sub yet
      .mockResolvedValueOnce(existing as never) // email match
      .mockResolvedValueOnce({ id: "user-2", email: "other@gmail.com", googleSub: SUB } as never); // owner lookup
    updateManyMock.mockRejectedValue(new Error("Unique constraint failed"));

    const response = await GET(new Request(callbackUrl()));

    expect(redirectError(response)).toBe(GOOGLE_LOGIN_USER_ERROR);
    expect(auditActions()).toEqual(["auth.google_identity_conflict"]);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("never overwrites an account already linked to a different Google identity", async () => {
    primeHappyPath({ email: "user@gmail.com" });
    const existing = { id: "user-1", email: "user@gmail.com", googleSub: "other-sub" };
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce(null); // our sub has no owner
    updateManyMock.mockResolvedValue({ count: 0 } as never); // guard: googleSub already set

    const response = await GET(new Request(callbackUrl()));

    expect(redirectError(response)).toBe(GOOGLE_LOGIN_USER_ERROR);
    expect(auditActions()).toEqual(["auth.google_identity_conflict"]);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("treats a concurrent same-account link as a normal sign-in", async () => {
    primeHappyPath({ email: "user@gmail.com" });
    const existing = { id: "user-1", email: "user@gmail.com", googleSub: null, isAdmin: false };
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce({ ...existing, googleSub: SUB } as never); // concurrent winner
    updateManyMock.mockResolvedValue({ count: 0 } as never);

    const response = await GET(new Request(callbackUrl()));

    expect(setSessionMock).toHaveBeenCalledWith("user@gmail.com");
    expect(auditActions()).toEqual(["auth.google_login"]);
    expect(response.headers.get("location")).toBe("https://app.example.com/workspace");
  });

  it("keeps blocking ineligible accounts", async () => {
    primeHappyPath({ email: "blocked@gmail.com" });
    const blocked = {
      id: "user-3",
      email: "blocked@gmail.com",
      googleSub: null,
      eligibilityBlockedAt: new Date()
    };
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(blocked as never);

    const response = await GET(new Request(callbackUrl()));

    expect(redirectError(response)).toBe(GOOGLE_LOGIN_ACCOUNT_INELIGIBLE_ERROR);
    expect(auditActions()).toEqual(["auth.google_login_blocked"]);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(setSessionMock).not.toHaveBeenCalled();
  });
});
