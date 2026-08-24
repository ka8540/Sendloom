import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, redisMock, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    envMock: { AUTH_OTP_SECRET: "test-auth-otp-secret-with-at-least-32-bytes" },
    store,
    redisMock: {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      eval: vi.fn()
    }
  };
});

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/redis", () => ({ getRedis: () => redisMock }));

import {
  AUTH_OTP_EXPIRES_SECONDS,
  createAuthOtpChallenge,
  createAuthOtpDigest,
  generateAuthOtpCode,
  maskEmail,
  rotateAuthOtpChallenge,
  verifyAndConsumeAuthOtpChallenge
} from "@/lib/auth-otp";

function installLuaEmulator() {
  redisMock.eval.mockImplementation(async (script: string, _keys: number, key: string, ...args: string[]) => {
    const raw = store.get(key);
    if (!raw) return ["not_found"];
    const challenge = JSON.parse(raw) as Record<string, unknown>;
    const purpose = args[0];
    const userId = args[1];
    const now = Number(args[2]);
    if (challenge.purpose !== purpose || (userId && challenge.userId !== userId)) return ["context_mismatch"];
    if (Number(challenge.expiresAt) <= now) {
      store.delete(key);
      return ["expired"];
    }

    if (script.includes("challenge.sendCount")) {
      const maxAttempts = Number(args[7]);
      const maxEmails = Number(args[8]);
      if (Number(challenge.attempts) >= maxAttempts) {
        store.delete(key);
        return ["exhausted"];
      }
      if (Number(challenge.sendCount) >= maxEmails) return ["email_limit"];
      const waitMs = Number(challenge.lastSentAt) + Number(args[6]) * 1000 - now;
      if (waitMs > 0) return ["cooldown", String(Math.ceil(waitMs / 1000))];
      challenge.otpDigest = args[3];
      challenge.issuedAt = now;
      challenge.lastSentAt = now;
      challenge.expiresAt = Number(args[4]);
      challenge.sendCount = Number(challenge.sendCount) + 1;
      const next = JSON.stringify(challenge);
      store.set(key, next);
      return ["rotated", next];
    }

    const expectedDigest = args[3];
    const maxAttempts = Number(args[4]);
    if (Number(challenge.attempts) >= maxAttempts) {
      store.delete(key);
      return ["exhausted"];
    }
    if (challenge.otpDigest !== expectedDigest) return ["invalid"];

    if (script.includes("return {'claimed'")) {
      store.delete(key);
      return ["claimed", raw];
    }

    const attempts = Number(challenge.attempts) + 1;
    if (attempts >= maxAttempts) {
      store.delete(key);
      return ["exhausted"];
    }
    challenge.attempts = attempts;
    store.set(key, JSON.stringify(challenge));
    return ["invalid", String(attempts)];
  });
}

function differentCode(code: string, offset = 1) {
  return String((Number(code) + offset) % 1_000_000).padStart(6, "0");
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  envMock.AUTH_OTP_SECRET = "test-auth-otp-secret-with-at-least-32-bytes";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-23T17:00:00.000Z"));
  installLuaEmulator();
});

afterEach(() => vi.useRealTimers());

describe("auth OTP primitives", () => {
  it("always generates exactly six numeric digits", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(generateAuthOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("uses a secret-keyed, context-bound digest", () => {
    const first = createAuthOtpDigest("challenge", "SIGNUP", "123456");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(createAuthOtpDigest("other", "SIGNUP", "123456"));
    expect(first).not.toBe(createAuthOtpDigest("challenge", "PASSWORD_CHANGE", "123456"));
    expect(first).not.toBe(createAuthOtpDigest("challenge", "PASSWORD_RESET", "123456"));
    envMock.AUTH_OTP_SECRET = "a-different-test-secret-with-at-least-32-bytes";
    expect(first).not.toBe(createAuthOtpDigest("challenge", "SIGNUP", "123456"));
  });

  it("masks email without repeating the full local part", () => {
    expect(maskEmail("kush.ahir2024@gmail.com")).toBe("ku***@gmail.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });
});

describe("auth OTP challenge lifecycle", () => {
  it("stores only the digest and an already-hashed signup password with a 10-minute TTL", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "SIGNUP",
      normalizedEmail: "user@example.com",
      passwordHash: "bcrypt-hash-only"
    });

    expect(pending.metadata.expiresInSeconds).toBe(AUTH_OTP_EXPIRES_SECONDS);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(pending.challengeId),
      expect.any(String),
      "EX",
      AUTH_OTP_EXPIRES_SECONDS
    );
    const serialized = [...store.values()][0] ?? "";
    expect(serialized).not.toContain(pending.code);
    expect(serialized).toContain("bcrypt-hash-only");
    expect(serialized).not.toContain('"code"');
  });

  it("atomically consumes a correct code exactly once", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "SIGNUP",
      normalizedEmail: "user@example.com",
      passwordHash: "hash"
    });
    const input = { challengeId: pending.challengeId, purpose: "SIGNUP" as const, code: pending.code };

    expect((await verifyAndConsumeAuthOtpChallenge(input)).ok).toBe(true);
    expect(await verifyAndConsumeAuthOtpChallenge(input)).toEqual({ ok: false, reason: "not_found" });
  });

  it("allows only one concurrent correct verification to claim a challenge", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail: "user@example.com",
      userId: "user-1"
    });
    const input = {
      challengeId: pending.challengeId,
      purpose: "PASSWORD_RESET" as const,
      code: pending.code
    };

    const results = await Promise.all([verifyAndConsumeAuthOtpChallenge(input), verifyAndConsumeAuthOtpChallenge(input)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("increments incorrect attempts and invalidates the fifth failure", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "SIGNUP",
      normalizedEmail: "user@example.com",
      passwordHash: "hash"
    });
    const wrong = differentCode(pending.code);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(
        await verifyAndConsumeAuthOtpChallenge({
          challengeId: pending.challengeId,
          purpose: "SIGNUP",
          code: wrong
        })
      ).toEqual({ ok: false, reason: "invalid" });
    }
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "SIGNUP",
        code: wrong
      })
    ).toEqual({ ok: false, reason: "exhausted" });
    expect(store.size).toBe(0);
  });

  it("cannot race concurrent wrong guesses around the five-attempt limit", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail: "user@example.com",
      userId: "user-1"
    });
    const wrong = differentCode(pending.code);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        verifyAndConsumeAuthOtpChallenge({
          challengeId: pending.challengeId,
          purpose: "PASSWORD_RESET",
          code: wrong
        })
      )
    );

    expect(results.filter((result) => result.ok)).toHaveLength(0);
    expect(store.size).toBe(0);
    expect(results.some((result) => !result.ok && result.reason === "exhausted")).toBe(true);
  });

  it("stores a reset target or a null decoy without any password material", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail: "unknown@example.com",
      userId: null
    });
    const serialized = [...store.values()][0] ?? "";
    const stored = JSON.parse(serialized) as Record<string, unknown>;

    expect(serialized).not.toContain(pending.code);
    expect(stored).not.toHaveProperty("passwordHash");
    expect(stored).not.toHaveProperty("newPassword");
    expect(stored).not.toHaveProperty("sessionJwt");
    expect(stored).not.toHaveProperty("isAdmin");
    expect(stored).toMatchObject({ purpose: "PASSWORD_RESET", userId: null });
  });

  it("isolates reset, signup, and password-change purposes", async () => {
    const signup = await createAuthOtpChallenge({
      purpose: "SIGNUP",
      normalizedEmail: "signup@example.com",
      passwordHash: "hash"
    });
    const passwordChange = await createAuthOtpChallenge({
      purpose: "PASSWORD_CHANGE",
      normalizedEmail: "change@example.com",
      userId: "user-2",
      newPasswordHash: "new-hash",
      hadPassword: true
    });
    const reset = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail: "reset@example.com",
      userId: "user-3"
    });

    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: signup.challengeId,
        purpose: "PASSWORD_RESET",
        code: signup.code
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: passwordChange.challengeId,
        purpose: "PASSWORD_RESET",
        code: passwordChange.code
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: reset.challengeId,
        purpose: "SIGNUP",
        code: reset.code
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: reset.challengeId,
        purpose: "PASSWORD_CHANGE",
        code: reset.code,
        userId: "user-3"
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });
  });

  it("rejects expiration, purpose mismatch, and password-challenge ownership mismatch", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_CHANGE",
      normalizedEmail: "user@example.com",
      userId: "user-1",
      newPasswordHash: "new-hash",
      hadPassword: true
    });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "SIGNUP",
        code: pending.code
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "PASSWORD_CHANGE",
        code: pending.code,
        userId: "user-2"
      })
    ).toEqual({ ok: false, reason: "context_mismatch" });

    vi.advanceTimersByTime(AUTH_OTP_EXPIRES_SECONDS * 1000 + 1);
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "PASSWORD_CHANGE",
        code: pending.code,
        userId: "user-1"
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("enforces resend cooldown, rotates the digest, and invalidates the old code", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "SIGNUP",
      normalizedEmail: "user@example.com",
      passwordHash: "hash"
    });
    expect(await rotateAuthOtpChallenge({ challengeId: pending.challengeId, purpose: "SIGNUP" })).toMatchObject({
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: 60
    });

    vi.advanceTimersByTime(60_000);
    const rotated = await rotateAuthOtpChallenge({ challengeId: pending.challengeId, purpose: "SIGNUP" });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.code).not.toBe(pending.code);
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "SIGNUP",
        code: pending.code
      })
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await verifyAndConsumeAuthOtpChallenge({
        challengeId: pending.challengeId,
        purpose: "SIGNUP",
        code: rotated.code
      })
    ).toMatchObject({ ok: true });
  });

  it("caps each challenge at five total email sends", async () => {
    const pending = await createAuthOtpChallenge({
      purpose: "PASSWORD_RESET",
      normalizedEmail: "user@example.com",
      userId: "user-1"
    });

    for (let resend = 0; resend < 4; resend += 1) {
      vi.advanceTimersByTime(60_000);
      expect(
        await rotateAuthOtpChallenge({ challengeId: pending.challengeId, purpose: "PASSWORD_RESET" })
      ).toMatchObject({ ok: true });
    }
    vi.advanceTimersByTime(60_000);
    expect(
      await rotateAuthOtpChallenge({ challengeId: pending.challengeId, purpose: "PASSWORD_RESET" })
    ).toEqual({ ok: false, reason: "email_limit" });
  });
});
