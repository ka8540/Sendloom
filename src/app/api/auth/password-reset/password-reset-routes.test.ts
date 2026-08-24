import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  createPasswordHash: vi.fn(),
  verifyPassword: vi.fn(),
  createChallenge: vi.fn(),
  peekChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  rotateChallenge: vi.fn(),
  sendCode: vi.fn(),
  createGrant: vi.fn(),
  consumeGrant: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } }
}));
vi.mock("@/lib/auth", () => ({
  createPasswordHash: mocks.createPasswordHash,
  normalizeUserEmail: (email: string) => email.trim().toLowerCase(),
  verifyPassword: mocks.verifyPassword
}));
vi.mock("@/lib/auth-email", () => ({ sendAuthVerificationCode: mocks.sendCode }));
vi.mock("@/lib/auth-otp", () => ({
  createAuthOtpChallenge: mocks.createChallenge,
  createAuthOtpSubjectKey: () => "opaque-email-key",
  getAuthOtpChallengeForContext: mocks.peekChallenge,
  verifyAndConsumeAuthOtpChallenge: mocks.verifyChallenge,
  rotateAuthOtpChallenge: mocks.rotateChallenge
}));
vi.mock("@/lib/password-reset", () => ({
  createPasswordResetGrant: mocks.createGrant,
  consumePasswordResetGrant: mocks.consumeGrant,
  createPasswordResetGrantDigest: () => "hashed-grant-key"
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "203.0.113.21",
  rateLimit: mocks.rateLimit,
  createRateLimitResponse: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 })
}));

import { POST as completeReset } from "./complete/route";
import { POST as requestReset } from "./request/route";
import { POST as resendReset } from "./resend/route";
import { POST as verifyReset } from "./verify/route";

const user = {
  id: "user-1",
  email: "user@example.com",
  isAdmin: false,
  passwordHash: "old-hash",
  googleSub: null,
  restrictedAt: new Date("2026-08-01T00:00:00.000Z"),
  eligibilityBlockedAt: null
};
const metadata = {
  challengeId: "r".repeat(43),
  maskedEmail: "us***@example.com",
  expiresInSeconds: 600,
  resendAvailableInSeconds: 60
};
const resetChallenge = {
  version: 1 as const,
  purpose: "PASSWORD_RESET" as const,
  normalizedEmail: user.email,
  userId: user.id,
  otpDigest: "otp-digest",
  attempts: 0,
  issuedAt: 1,
  expiresAt: 2,
  lastSentAt: 1,
  sendCount: 1
};
const resetGrant = "g".repeat(43);
const grantRecord = {
  version: 1 as const,
  purpose: "PASSWORD_RESET" as const,
  userId: user.id,
  normalizedEmail: user.email,
  issuedAt: 1,
  expiresAt: 2
};

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://sendloom.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
  mocks.findUnique.mockResolvedValue(user);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.createPasswordHash.mockResolvedValue("$2b$12$new-bcrypt-hash");
  mocks.verifyPassword.mockResolvedValue(false);
  mocks.createChallenge.mockImplementation(async (input: { normalizedEmail: string; userId: string | null }) => ({
    ...metadata,
    metadata,
    code: "583291",
    challenge: { ...resetChallenge, normalizedEmail: input.normalizedEmail, userId: input.userId }
  }));
  mocks.peekChallenge.mockResolvedValue(resetChallenge);
  mocks.verifyChallenge.mockResolvedValue({ ok: true, challenge: resetChallenge });
  mocks.rotateChallenge.mockResolvedValue({
    ok: true,
    challenge: { ...resetChallenge, otpDigest: "rotated-digest", sendCount: 2 },
    code: "654321",
    metadata
  });
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.createGrant.mockResolvedValue({ resetGrant, expiresInSeconds: 600 });
  mocks.consumeGrant.mockResolvedValue({ ok: true, grant: grantRecord });
  mocks.audit.mockResolvedValue(undefined);
});

describe("POST /api/auth/password-reset/request", () => {
  it("normalizes a known password account, creates a bound challenge, and attempts email delivery", async () => {
    const response = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: " User@Example.com " })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: user.email },
      select: { id: true, email: true, isAdmin: true }
    });
    expect(mocks.createChallenge).toHaveBeenCalledWith({
      purpose: "PASSWORD_RESET",
      normalizedEmail: user.email,
      userId: user.id
    });
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: user.email,
      purpose: "PASSWORD_RESET",
      code: "583291"
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "auth:password-reset:request:email:opaque-email-key",
      limit: 3,
      windowSeconds: 60 * 15
    });
    expect(payload).toEqual(expect.objectContaining({ success: true, requiresVerification: true, ...metadata }));
    expect(JSON.stringify(payload)).not.toMatch(/userId|passwordHash|googleSub|isAdmin|583291/);
  });

  it("also emails a Google-only normal account without changing its account type", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...user, passwordHash: null, googleSub: "google-sub" });
    const response = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );

    expect(response.status).toBe(200);
    expect(mocks.sendCode).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns the same public result for unknown addresses while creating a non-emailing decoy", async () => {
    const knownResponse = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );
    const knownPayload = await knownResponse.json();
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
    mocks.findUnique.mockResolvedValue(null);
    mocks.createChallenge.mockImplementation(async (input: { normalizedEmail: string; userId: string | null }) => ({
      ...metadata,
      metadata,
      code: "999999",
      challenge: { ...resetChallenge, normalizedEmail: input.normalizedEmail, userId: input.userId }
    }));

    const unknownResponse = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );
    const unknownPayload = await unknownResponse.json();

    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownPayload).toEqual(knownPayload);
    expect(mocks.createChallenge).toHaveBeenCalledWith({
      purpose: "PASSWORD_RESET",
      normalizedEmail: user.email,
      userId: null
    });
    expect(mocks.sendCode).not.toHaveBeenCalled();
  });

  it("treats bootstrap admins as non-authorizing decoys", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...user, isAdmin: true });
    const response = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );

    expect(response.status).toBe(200);
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(mocks.sendCode).not.toHaveBeenCalled();
  });

  it("keeps generic success semantics if Resend is unavailable", async () => {
    mocks.sendCode.mockRejectedValueOnce(new Error("provider down"));
    const response = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ success: true, ...metadata }));
  });

  it("rejects malformed email and enforces request rate limiting", async () => {
    const malformed = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: "not-an-email" })
    );
    expect(malformed.status).toBe(400);
    expect(mocks.createChallenge).not.toHaveBeenCalled();

    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const limited = await requestReset(
      jsonRequest("/api/auth/password-reset/request", { email: user.email })
    );
    expect(limited.status).toBe(429);
  });
});

describe("POST /api/auth/password-reset/verify", () => {
  it("consumes a valid reset OTP and returns only a one-time reset grant", async () => {
    const response = await verifyReset(
      jsonRequest("/api/auth/password-reset/verify", { challengeId: metadata.challengeId, code: "583291" })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.verifyChallenge).toHaveBeenCalledWith({
      challengeId: metadata.challengeId,
      purpose: "PASSWORD_RESET",
      code: "583291"
    });
    expect(mocks.createGrant).toHaveBeenCalledWith({ userId: user.id, normalizedEmail: user.email });
    expect(payload).toEqual({ success: true, resetGrant });
    expect(JSON.stringify(payload)).not.toContain(user.id);
  });

  it("rejects wrong OTPs without issuing a grant", async () => {
    mocks.verifyChallenge.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const response = await verifyReset(
      jsonRequest("/api/auth/password-reset/verify", { challengeId: metadata.challengeId, code: "000000" })
    );

    expect(response.status).toBe(400);
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("consumes a guessed decoy OTP but never issues a reset grant", async () => {
    const decoy = { ...resetChallenge, userId: null };
    mocks.peekChallenge.mockResolvedValueOnce(decoy);
    mocks.verifyChallenge.mockResolvedValueOnce({ ok: true, challenge: decoy });
    const response = await verifyReset(
      jsonRequest("/api/auth/password-reset/verify", { challengeId: metadata.challengeId, code: "583291" })
    );

    expect(response.status).toBe(400);
    expect(mocks.createGrant).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects attempts to mix another email or user context into OTP verification", async () => {
    const response = await verifyReset(
      jsonRequest("/api/auth/password-reset/verify", {
        challengeId: metadata.challengeId,
        code: "583291",
        email: "other@example.com"
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.verifyChallenge).not.toHaveBeenCalled();
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/password-reset/resend", () => {
  it("rotates a real reset challenge and sends only the replacement code", async () => {
    const response = await resendReset(
      jsonRequest("/api/auth/password-reset/resend", { challengeId: metadata.challengeId })
    );

    expect(response.status).toBe(200);
    expect(mocks.rotateChallenge).toHaveBeenCalledWith({
      challengeId: metadata.challengeId,
      purpose: "PASSWORD_RESET"
    });
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: user.email,
      purpose: "PASSWORD_RESET",
      code: "654321"
    });
  });

  it("rotates decoys identically but never calls Resend", async () => {
    const decoy = { ...resetChallenge, userId: null };
    mocks.peekChallenge.mockResolvedValueOnce(decoy);
    mocks.rotateChallenge.mockResolvedValueOnce({
      ok: true,
      challenge: decoy,
      code: "654321",
      metadata
    });
    const response = await resendReset(
      jsonRequest("/api/auth/password-reset/resend", { challengeId: metadata.challengeId })
    );

    expect(response.status).toBe(200);
    expect(mocks.sendCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/password-reset/complete", () => {
  it("updates only the grant-bound password and revokes every existing session", async () => {
    const response = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.consumeGrant).toHaveBeenCalledWith(resetGrant);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "auth:password-reset:complete:grant:hashed-grant-key",
      limit: 5,
      windowSeconds: 60 * 15
    });
    expect(mocks.createPasswordHash).toHaveBeenCalledWith("new-password-value");
    expect(mocks.verifyPassword).toHaveBeenCalledWith("new-password-value", user.passwordHash);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: user.id,
        email: user.email,
        isAdmin: false,
        passwordHash: user.passwordHash
      },
      data: {
        passwordHash: "$2b$12$new-bcrypt-hash",
        sessionIssuedAt: expect.any(Date),
        sessionExpiresAt: null
      }
    });
    const data = mocks.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["passwordHash", "sessionExpiresAt", "sessionIssuedAt"]);
    expect(JSON.stringify(data)).not.toContain("new-password-value");
  });

  it("rejects the current password after consuming the one-time grant", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(true);
    const response = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "old-password-value",
        confirmPassword: "old-password-value"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Your new password must be different from your current password. Start password recovery again.",
      restartRequired: true
    });
    expect(mocks.consumeGrant).toHaveBeenCalledWith(resetGrant);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("old-password-value", user.passwordHash);
    expect(mocks.createPasswordHash).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("preserves Google linkage, admin status, and account restrictions by never updating them", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...user, passwordHash: null, googleSub: "google-sub" });
    await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );

    const data = mocks.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ passwordHash: null }) })
    );
    expect(data).not.toHaveProperty("googleSub");
    expect(data).not.toHaveProperty("isAdmin");
    expect(data).not.toHaveProperty("restrictedAt");
    expect(data).not.toHaveProperty("eligibilityBlockedAt");
  });

  it("rejects mismatch and short passwords before consuming the grant", async () => {
    const mismatch = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "different-password"
      })
    );
    expect(mismatch.status).toBe(400);
    expect(mocks.consumeGrant).not.toHaveBeenCalled();

    const short = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "short",
        confirmPassword: "short"
      })
    );
    expect(short.status).toBe(400);
    expect(mocks.consumeGrant).not.toHaveBeenCalled();
  });

  it("rejects invalid, expired, cross-email, admin, and client-selected-user contexts", async () => {
    mocks.consumeGrant.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const invalid = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(invalid.status).toBe(410);
    expect(mocks.updateMany).not.toHaveBeenCalled();

    mocks.consumeGrant.mockResolvedValueOnce({ ok: true, grant: grantRecord });
    mocks.findUnique.mockResolvedValueOnce({ ...user, email: "other@example.com" });
    const crossEmail = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(crossEmail.status).toBe(410);
    expect(mocks.updateMany).not.toHaveBeenCalled();

    mocks.consumeGrant.mockResolvedValueOnce({ ok: true, grant: grantRecord });
    mocks.findUnique.mockResolvedValueOnce({ ...user, isAdmin: true });
    const admin = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(admin.status).toBe(410);
    expect(mocks.updateMany).not.toHaveBeenCalled();

    const selectedUser = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value",
        userId: "user-2"
      })
    );
    expect(selectedUser.status).toBe(400);
    expect(mocks.consumeGrant).toHaveBeenCalledTimes(3);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("allows at most one concurrent completion for the same grant", async () => {
    mocks.consumeGrant
      .mockResolvedValueOnce({ ok: true, grant: grantRecord })
      .mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const body = { resetGrant, newPassword: "new-password-value", confirmPassword: "new-password-value" };
    const responses = await Promise.all([
      completeReset(jsonRequest("/api/auth/password-reset/complete", body)),
      completeReset(jsonRequest("/api/auth/password-reset/complete", body))
    ]);

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("fails closed if another reset changes the password after it was checked", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await completeReset(
      jsonRequest("/api/auth/password-reset/complete", {
        resetGrant,
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );

    expect(response.status).toBe(410);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ passwordHash: user.passwordHash }) })
    );
    expect(mocks.audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.password_reset_completed" })
    );
  });
});
