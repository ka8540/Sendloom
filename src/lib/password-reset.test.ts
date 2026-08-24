import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redisMock, store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    redisMock: {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      eval: vi.fn()
    }
  };
});

vi.mock("@/lib/redis", () => ({ getRedis: () => redisMock }));

import {
  PASSWORD_RESET_GRANT_EXPIRES_SECONDS,
  consumePasswordResetGrant,
  createPasswordResetGrant,
  createPasswordResetGrantDigest
} from "@/lib/password-reset";

function installLuaEmulator() {
  redisMock.eval.mockImplementation(async (_script: string, _keys: number, key: string, now: string) => {
    const raw = store.get(key);
    if (!raw) return ["invalid"];
    const grant = JSON.parse(raw) as Record<string, unknown>;
    if (grant.version !== 1 || grant.purpose !== "PASSWORD_RESET") {
      store.delete(key);
      return ["invalid"];
    }
    if (Number(grant.expiresAt) <= Number(now)) {
      store.delete(key);
      return ["expired"];
    }
    store.delete(key);
    return ["claimed", raw];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
  installLuaEmulator();
});

afterEach(() => vi.useRealTimers());

describe("password reset grants", () => {
  it("stores only a SHA-256-addressed grant record for ten minutes", async () => {
    const created = await createPasswordResetGrant({
      userId: "user-1",
      normalizedEmail: "user@example.com"
    });

    expect(created.resetGrant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(createPasswordResetGrantDigest(created.resetGrant)),
      expect.any(String),
      "EX",
      PASSWORD_RESET_GRANT_EXPIRES_SECONDS
    );
    const [key, serialized = ""] = [...store.entries()][0] ?? [];
    expect(key).not.toContain(created.resetGrant);
    expect(serialized).not.toContain(created.resetGrant);
    expect(serialized).not.toMatch(/passwordHash|newPassword|confirmPassword/);
    expect(JSON.parse(serialized)).toMatchObject({
      version: 1,
      purpose: "PASSWORD_RESET",
      userId: "user-1",
      normalizedEmail: "user@example.com"
    });
  });

  it("atomically authorizes one use and rejects replay", async () => {
    const created = await createPasswordResetGrant({
      userId: "user-1",
      normalizedEmail: "user@example.com"
    });

    const [first, second] = await Promise.all([
      consumePasswordResetGrant(created.resetGrant),
      consumePasswordResetGrant(created.resetGrant)
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)).toHaveLength(1);
    expect(await consumePasswordResetGrant(created.resetGrant)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects expired and random grants", async () => {
    const created = await createPasswordResetGrant({
      userId: "user-1",
      normalizedEmail: "user@example.com"
    });
    vi.advanceTimersByTime(PASSWORD_RESET_GRANT_EXPIRES_SECONDS * 1000 + 1);

    expect(await consumePasswordResetGrant(created.resetGrant)).toEqual({ ok: false, reason: "expired" });
    expect(await consumePasswordResetGrant("x".repeat(43))).toEqual({ ok: false, reason: "invalid" });
  });
});
