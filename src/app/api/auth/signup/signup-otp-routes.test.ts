import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createUser: vi.fn(),
  createPasswordHash: vi.fn(),
  setSession: vi.fn(),
  createChallenge: vi.fn(),
  deleteChallenge: vi.fn(),
  peekChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  rotateChallenge: vi.fn(),
  sendCode: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.findUnique, create: mocks.createUser } }
}));
vi.mock("@/lib/auth", () => ({
  createPasswordHash: mocks.createPasswordHash,
  normalizeUserEmail: (email: string) => email.trim().toLowerCase(),
  setSession: mocks.setSession
}));
vi.mock("@/lib/auth-email", () => ({ sendAuthVerificationCode: mocks.sendCode }));
vi.mock("@/lib/auth-otp", () => ({
  createAuthOtpChallenge: mocks.createChallenge,
  createAuthOtpSubjectKey: () => "email-key",
  deleteAuthOtpChallenge: mocks.deleteChallenge,
  getAuthOtpChallengeForContext: mocks.peekChallenge,
  verifyAndConsumeAuthOtpChallenge: mocks.verifyChallenge,
  rotateAuthOtpChallenge: mocks.rotateChallenge
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.9",
  rateLimit: mocks.rateLimit,
  createRateLimitResponse: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 })
}));

import { POST as startSignup } from "./route";
import { POST as resendSignup } from "./resend/route";
import { POST as verifySignup } from "./verify/route";

const challenge = {
  version: 1 as const,
  purpose: "SIGNUP" as const,
  normalizedEmail: "user@example.com",
  passwordHash: "bcrypt-hash",
  otpDigest: "digest",
  attempts: 0,
  issuedAt: 1,
  expiresAt: 2,
  lastSentAt: 1,
  sendCount: 1
};
const metadata = {
  challengeId: "a".repeat(43),
  maskedEmail: "us***@example.com",
  expiresInSeconds: 600,
  resendAvailableInSeconds: 60
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
  mocks.findUnique.mockResolvedValue(null);
  mocks.createPasswordHash.mockResolvedValue("bcrypt-hash");
  mocks.createChallenge.mockResolvedValue({ ...metadata, challenge, code: "583291", metadata });
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.deleteChallenge.mockResolvedValue(undefined);
  mocks.peekChallenge.mockResolvedValue(challenge);
  mocks.verifyChallenge.mockResolvedValue({ ok: true, challenge });
  mocks.rotateChallenge.mockResolvedValue({ ok: false, reason: "cooldown", retryAfterSeconds: 60 });
  mocks.createUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  mocks.setSession.mockResolvedValue(undefined);
});

describe("POST /api/auth/signup starts verification", () => {
  it("validates password requirements before creating a challenge", async () => {
    const response = await startSignup(
      jsonRequest("https://sendloom.test/api/auth/signup", {
        email: "user@example.com",
        password: "short",
        confirmPassword: "short"
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });

  it("hashes the password, sends an OTP, but creates no user and issues no session", async () => {
    const response = await startSignup(
      jsonRequest("https://sendloom.test/api/auth/signup", {
        email: " User@Example.com ",
        password: "long-enough-password",
        confirmPassword: "long-enough-password"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createPasswordHash).toHaveBeenCalledWith("long-enough-password");
    expect(mocks.createChallenge).toHaveBeenCalledWith({
      purpose: "SIGNUP",
      normalizedEmail: "user@example.com",
      passwordHash: "bcrypt-hash"
    });
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: "user@example.com",
      purpose: "SIGNUP",
      code: "583291"
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(payload).toEqual({ success: true, requiresVerification: true, ...metadata });
    expect(JSON.stringify(payload)).not.toContain("583291");
    expect(JSON.stringify(payload)).not.toContain("bcrypt-hash");
  });

  it("preserves existing password and Google-account conflicts", async () => {
    mocks.findUnique.mockResolvedValueOnce({ passwordHash: "hash" });
    const passwordConflict = await startSignup(
      jsonRequest("https://sendloom.test/api/auth/signup", {
        email: "user@example.com",
        password: "long-enough-password",
        confirmPassword: "long-enough-password"
      })
    );
    expect(passwordConflict.status).toBe(409);

    mocks.findUnique.mockResolvedValueOnce({ passwordHash: null });
    const googleConflict = await startSignup(
      jsonRequest("https://sendloom.test/api/auth/signup", {
        email: "user@example.com",
        password: "long-enough-password",
        confirmPassword: "long-enough-password"
      })
    );
    expect(googleConflict.status).toBe(409);
    expect((await googleConflict.json()).error).toContain("Google-based account");
  });

  it("invalidates the challenge and creates no user when email delivery fails", async () => {
    mocks.sendCode.mockRejectedValue(new Error("provider unavailable"));
    const response = await startSignup(
      jsonRequest("https://sendloom.test/api/auth/signup", {
        email: "user@example.com",
        password: "long-enough-password",
        confirmPassword: "long-enough-password"
      })
    );
    expect(response.status).toBe(503);
    expect(mocks.deleteChallenge).toHaveBeenCalledWith(metadata.challengeId);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup/verify", () => {
  it("creates the user and session only after a correct, atomically consumed OTP", async () => {
    const response = await verifySignup(
      jsonRequest("https://sendloom.test/api/auth/signup/verify", {
        challengeId: metadata.challengeId,
        code: "583291"
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.verifyChallenge).toHaveBeenCalledWith({
      challengeId: metadata.challengeId,
      purpose: "SIGNUP",
      code: "583291"
    });
    expect(mocks.createUser).toHaveBeenCalledWith({
      data: { email: "user@example.com", passwordHash: "bcrypt-hash" }
    });
    expect(mocks.setSession).toHaveBeenCalledWith("user@example.com");
  });

  it("does not create a user for an incorrect or expired OTP", async () => {
    mocks.verifyChallenge.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const incorrect = await verifySignup(
      jsonRequest("https://sendloom.test/api/auth/signup/verify", {
        challengeId: metadata.challengeId,
        code: "000000"
      })
    );
    expect(incorrect.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();

    mocks.verifyChallenge.mockResolvedValueOnce({ ok: false, reason: "expired" });
    const expired = await verifySignup(
      jsonRequest("https://sendloom.test/api/auth/signup/verify", {
        challengeId: metadata.challengeId,
        code: "583291"
      })
    );
    expect(expired.status).toBe(410);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("rechecks email uniqueness and safely handles a concurrent unique-constraint winner", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "other-user" });
    const claimed = await verifySignup(
      jsonRequest("https://sendloom.test/api/auth/signup/verify", {
        challengeId: metadata.challengeId,
        code: "583291"
      })
    );
    expect(claimed.status).toBe(409);
    expect(mocks.createUser).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.createUser.mockRejectedValueOnce({ code: "P2002" });
    const raced = await verifySignup(
      jsonRequest("https://sendloom.test/api/auth/signup/verify", {
        challengeId: metadata.challengeId,
        code: "583291"
      })
    );
    expect(raced.status).toBe(409);
    expect(mocks.setSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup/resend", () => {
  it("rotates the code only after server-enforced limits and sends the replacement", async () => {
    const rotated = { ...challenge, otpDigest: "new-digest", sendCount: 2 };
    mocks.rotateChallenge.mockResolvedValue({
      ok: true,
      challenge: rotated,
      code: "654321",
      metadata
    });

    const response = await resendSignup(
      jsonRequest("https://sendloom.test/api/auth/signup/resend", { challengeId: metadata.challengeId })
    );
    expect(response.status).toBe(200);
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: "user@example.com",
      purpose: "SIGNUP",
      code: "654321"
    });
  });
});
