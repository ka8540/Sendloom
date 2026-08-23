import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  updateUser: vi.fn(),
  verifyPassword: vi.fn(),
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

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update: mocks.updateUser } } }));
vi.mock("@/lib/auth", () => ({
  verifyPassword: mocks.verifyPassword,
  createPasswordHash: mocks.createPasswordHash,
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
  getClientIp: () => "203.0.113.10",
  rateLimit: mocks.rateLimit,
  createRateLimitResponse: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 })
}));

import { POST as startPassword } from "./route";
import { POST as resendPassword } from "./resend/route";
import { POST as verifyPasswordChange } from "./verify/route";

const user = { id: "user-1", email: "user@example.com", passwordHash: "old-hash" };
const passwordChallenge = {
  version: 1 as const,
  purpose: "PASSWORD_CHANGE" as const,
  normalizedEmail: user.email,
  userId: user.id,
  newPasswordHash: "new-bcrypt-hash",
  hadPassword: true,
  otpDigest: "digest",
  attempts: 0,
  issuedAt: 1,
  expiresAt: 2,
  lastSentAt: 1,
  sendCount: 1
};
const metadata = {
  challengeId: "p".repeat(43),
  maskedEmail: "us***@example.com",
  expiresInSeconds: 600,
  resendAvailableInSeconds: 60
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
  mocks.requireUser.mockResolvedValue({ user });
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.createPasswordHash.mockResolvedValue("new-bcrypt-hash");
  mocks.createChallenge.mockResolvedValue({ challenge: passwordChallenge, code: "583291", metadata, ...metadata });
  mocks.deleteChallenge.mockResolvedValue(undefined);
  mocks.peekChallenge.mockResolvedValue(passwordChallenge);
  mocks.verifyChallenge.mockResolvedValue({ ok: true, challenge: passwordChallenge });
  mocks.rotateChallenge.mockResolvedValue({
    ok: true,
    challenge: passwordChallenge,
    code: "654321",
    metadata
  });
  mocks.sendCode.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue(user);
  mocks.setSession.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe("POST /api/account/password starts step-up verification", () => {
  it("requires an authenticated user", async () => {
    mocks.requireUser.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });
    const response = await startPassword(
      jsonRequest("/api/account/password", {
        currentPassword: "current-password",
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(response.status).toBe(401);
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });

  it("verifies the current password before hashing or sending an OTP", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);
    const response = await startPassword(
      jsonRequest("/api/account/password", {
        currentPassword: "wrong-password",
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.createPasswordHash).not.toHaveBeenCalled();
    expect(mocks.sendCode).not.toHaveBeenCalled();
  });

  it("stores only a pending new hash and does not update the password or rotate the session", async () => {
    const response = await startPassword(
      jsonRequest("/api/account/password", {
        currentPassword: "current-password",
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.createChallenge).toHaveBeenCalledWith({
      purpose: "PASSWORD_CHANGE",
      normalizedEmail: user.email,
      userId: user.id,
      newPasswordHash: "new-bcrypt-hash",
      hadPassword: true
    });
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: user.email,
      purpose: "PASSWORD_CHANGE",
      code: "583291"
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("new-bcrypt-hash");
    expect(JSON.stringify(payload)).not.toContain("583291");
  });

  it("lets a Google-only account begin setting a password without a current password", async () => {
    mocks.requireUser.mockResolvedValueOnce({ user: { ...user, passwordHash: null } });
    const response = await startPassword(
      jsonRequest("/api/account/password", {
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ hadPassword: false }));
  });

  it("invalidates a pending challenge when email delivery fails", async () => {
    mocks.sendCode.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await startPassword(
      jsonRequest("/api/account/password", {
        currentPassword: "current-password",
        newPassword: "new-password-value",
        confirmPassword: "new-password-value"
      })
    );
    expect(response.status).toBe(503);
    expect(mocks.deleteChallenge).toHaveBeenCalledWith(metadata.challengeId);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/password/verify commits the password", () => {
  it("binds verification to the authenticated user, then updates and rotates the session", async () => {
    const response = await verifyPasswordChange(
      jsonRequest("/api/account/password/verify", { challengeId: metadata.challengeId, code: "583291" })
    );
    expect(response.status).toBe(200);
    expect(mocks.verifyChallenge).toHaveBeenCalledWith({
      challengeId: metadata.challengeId,
      purpose: "PASSWORD_CHANGE",
      code: "583291",
      userId: user.id
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { passwordHash: "new-bcrypt-hash" }
    });
    expect(mocks.setSession).toHaveBeenCalledWith(user.email);
  });

  it("does not update the password for invalid, expired, or wrong-owner challenges", async () => {
    for (const reason of ["invalid", "expired", "context_mismatch"] as const) {
      mocks.verifyChallenge.mockResolvedValueOnce({ ok: false, reason });
      const response = await verifyPasswordChange(
        jsonRequest("/api/account/password/verify", { challengeId: metadata.challengeId, code: "000000" })
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("records password_set after a verified Google-account password is committed", async () => {
    const googleChallenge = { ...passwordChallenge, hadPassword: false };
    mocks.peekChallenge.mockResolvedValueOnce(googleChallenge);
    mocks.verifyChallenge.mockResolvedValueOnce({ ok: true, challenge: googleChallenge });
    await verifyPasswordChange(
      jsonRequest("/api/account/password/verify", { challengeId: metadata.challengeId, code: "583291" })
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.password_set" }));
  });
});

describe("POST /api/account/password/resend", () => {
  it("checks ownership, rotates the OTP, and sends only the replacement code", async () => {
    const response = await resendPassword(
      jsonRequest("/api/account/password/resend", { challengeId: metadata.challengeId })
    );
    expect(response.status).toBe(200);
    expect(mocks.peekChallenge).toHaveBeenCalledWith(metadata.challengeId, "PASSWORD_CHANGE", user.id);
    expect(mocks.rotateChallenge).toHaveBeenCalledWith({
      challengeId: metadata.challengeId,
      purpose: "PASSWORD_CHANGE",
      userId: user.id
    });
    expect(mocks.sendCode).toHaveBeenCalledWith({
      to: user.email,
      purpose: "PASSWORD_CHANGE",
      code: "654321"
    });
  });
});
