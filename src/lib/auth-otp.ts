import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";

export const AUTH_OTP_EXPIRES_SECONDS = 10 * 60;
export const AUTH_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const AUTH_OTP_MAX_ATTEMPTS = 5;
export const AUTH_OTP_MAX_EMAILS_PER_CHALLENGE = 5;

export type AuthOtpPurpose = "SIGNUP" | "PASSWORD_CHANGE";

type AuthOtpChallengeBase = {
  version: 1;
  purpose: AuthOtpPurpose;
  normalizedEmail: string;
  otpDigest: string;
  attempts: number;
  issuedAt: number;
  expiresAt: number;
  lastSentAt: number;
  sendCount: number;
};

export type SignupOtpChallenge = AuthOtpChallengeBase & {
  purpose: "SIGNUP";
  passwordHash: string;
};

export type PasswordChangeOtpChallenge = AuthOtpChallengeBase & {
  purpose: "PASSWORD_CHANGE";
  userId: string;
  newPasswordHash: string;
  hadPassword: boolean;
};

export type AuthOtpChallenge = SignupOtpChallenge | PasswordChangeOtpChallenge;

export type AuthOtpPublicMetadata = {
  challengeId: string;
  maskedEmail: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
};

export class AuthOtpConfigurationError extends Error {
  constructor() {
    super("Authentication verification is not configured.");
    this.name = "AuthOtpConfigurationError";
  }
}

export type AuthOtpVerifyResult =
  | { ok: true; challenge: AuthOtpChallenge }
  | { ok: false; reason: "invalid" | "expired" | "exhausted" | "not_found" | "context_mismatch" };

export type AuthOtpResendResult =
  | { ok: true; challenge: AuthOtpChallenge; code: string; metadata: AuthOtpPublicMetadata }
  | {
      ok: false;
      reason: "cooldown" | "expired" | "exhausted" | "not_found" | "context_mismatch" | "email_limit";
      retryAfterSeconds?: number;
    };

const CHALLENGE_PREFIX = "auth-otp:challenge";

function challengeKey(challengeId: string) {
  return `${CHALLENGE_PREFIX}:${challengeId}`;
}

function getAuthOtpSecret() {
  const secret = env.AUTH_OTP_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new AuthOtpConfigurationError();
  }
  return secret;
}

export function generateAuthOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateAuthOtpChallengeId() {
  return randomBytes(32).toString("base64url");
}

export function createAuthOtpDigest(challengeId: string, purpose: AuthOtpPurpose, code: string) {
  return createHmac("sha256", getAuthOtpSecret())
    .update(`${challengeId}\u0000${purpose}\u0000${code}`, "utf8")
    .digest("hex");
}

/** Opaque stable key for Redis rate-limit dimensions; it never exposes email. */
export function createAuthOtpSubjectKey(normalizedEmail: string) {
  return createHmac("sha256", getAuthOtpSecret())
    .update(`rate-limit\u0000${normalizedEmail}`, "utf8")
    .digest("hex");
}

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visibleLength = local.length <= 1 ? 1 : Math.min(2, local.length);
  const visible = local.slice(0, visibleLength) || "*";
  return `${visible}***@${domain}`;
}

function publicMetadata(challengeId: string, challenge: AuthOtpChallenge, now = Date.now()): AuthOtpPublicMetadata {
  return {
    challengeId,
    maskedEmail: maskEmail(challenge.normalizedEmail),
    expiresInSeconds: Math.max(0, Math.ceil((challenge.expiresAt - now) / 1000)),
    resendAvailableInSeconds: Math.max(
      0,
      Math.ceil((challenge.lastSentAt + AUTH_OTP_RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000)
    )
  };
}

function parseChallenge(raw: string | null): AuthOtpChallenge | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<AuthOtpChallenge>;
    if (
      value.version !== 1 ||
      (value.purpose !== "SIGNUP" && value.purpose !== "PASSWORD_CHANGE") ||
      typeof value.normalizedEmail !== "string" ||
      typeof value.otpDigest !== "string" ||
      typeof value.attempts !== "number" ||
      typeof value.issuedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      typeof value.lastSentAt !== "number" ||
      typeof value.sendCount !== "number"
    ) {
      return null;
    }

    if (value.purpose === "SIGNUP" && typeof value.passwordHash === "string") {
      return value as SignupOtpChallenge;
    }

    if (
      value.purpose === "PASSWORD_CHANGE" &&
      typeof value.userId === "string" &&
      typeof value.newPasswordHash === "string" &&
      typeof value.hadPassword === "boolean"
    ) {
      return value as PasswordChangeOtpChallenge;
    }
  } catch {
    return null;
  }

  return null;
}

function contextMatches(challenge: AuthOtpChallenge, purpose: AuthOtpPurpose, userId?: string) {
  if (challenge.purpose !== purpose) {
    return false;
  }

  return purpose !== "PASSWORD_CHANGE" ||
    (challenge.purpose === "PASSWORD_CHANGE" && Boolean(userId) && challenge.userId === userId);
}

export async function createAuthOtpChallenge(
  input:
    | { purpose: "SIGNUP"; normalizedEmail: string; passwordHash: string }
    | {
        purpose: "PASSWORD_CHANGE";
        normalizedEmail: string;
        userId: string;
        newPasswordHash: string;
        hadPassword: boolean;
      }
) {
  // Validate configuration before generating or writing any pending secret.
  getAuthOtpSecret();
  const challengeId = generateAuthOtpChallengeId();
  const code = generateAuthOtpCode();
  const now = Date.now();
  const base: AuthOtpChallengeBase = {
    version: 1,
    purpose: input.purpose,
    normalizedEmail: input.normalizedEmail,
    otpDigest: createAuthOtpDigest(challengeId, input.purpose, code),
    attempts: 0,
    issuedAt: now,
    expiresAt: now + AUTH_OTP_EXPIRES_SECONDS * 1000,
    lastSentAt: now,
    sendCount: 1
  };
  const challenge: AuthOtpChallenge =
    input.purpose === "SIGNUP"
      ? { ...base, purpose: "SIGNUP", passwordHash: input.passwordHash }
      : {
          ...base,
          purpose: "PASSWORD_CHANGE",
          userId: input.userId,
          newPasswordHash: input.newPasswordHash,
          hadPassword: input.hadPassword
        };

  await getRedis().set(challengeKey(challengeId), JSON.stringify(challenge), "EX", AUTH_OTP_EXPIRES_SECONDS);
  return { challengeId, code, challenge, metadata: publicMetadata(challengeId, challenge, now) };
}

export async function deleteAuthOtpChallenge(challengeId: string) {
  await getRedis().del(challengeKey(challengeId));
}

export async function getAuthOtpChallengeForContext(
  challengeId: string,
  purpose: AuthOtpPurpose,
  userId?: string
) {
  const challenge = parseChallenge(await getRedis().get(challengeKey(challengeId)));
  if (!challenge || !contextMatches(challenge, purpose, userId) || challenge.expiresAt <= Date.now()) {
    return null;
  }
  return challenge;
}

const RECORD_FAILURE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'not_found'} end
local ok, challenge = pcall(cjson.decode, raw)
if not ok then redis.call('DEL', KEYS[1]); return {'not_found'} end
if challenge.purpose ~= ARGV[1] then return {'context_mismatch'} end
if ARGV[2] ~= '' and challenge.userId ~= ARGV[2] then return {'context_mismatch'} end
if tonumber(challenge.expiresAt or 0) <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]); return {'expired'}
end
if challenge.otpDigest ~= ARGV[4] then return {'invalid'} end
local attempts = tonumber(challenge.attempts or 0) + 1
if attempts >= tonumber(ARGV[5]) then
  redis.call('DEL', KEYS[1]); return {'exhausted'}
end
challenge.attempts = attempts
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then redis.call('DEL', KEYS[1]); return {'expired'} end
redis.call('SET', KEYS[1], cjson.encode(challenge), 'EX', ttl)
return {'invalid', tostring(attempts)}
`;

const CLAIM_CHALLENGE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'not_found'} end
local ok, challenge = pcall(cjson.decode, raw)
if not ok then redis.call('DEL', KEYS[1]); return {'not_found'} end
if challenge.purpose ~= ARGV[1] then return {'context_mismatch'} end
if ARGV[2] ~= '' and challenge.userId ~= ARGV[2] then return {'context_mismatch'} end
if tonumber(challenge.expiresAt or 0) <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]); return {'expired'}
end
if tonumber(challenge.attempts or 0) >= tonumber(ARGV[5]) then
  redis.call('DEL', KEYS[1]); return {'exhausted'}
end
if challenge.otpDigest ~= ARGV[4] then return {'invalid'} end
redis.call('DEL', KEYS[1])
return {'claimed', raw}
`;

function digestMatches(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

type RedisScriptResult = Array<string | number>;

function scriptStatus(result: RedisScriptResult) {
  return String(result[0] ?? "not_found");
}

export async function verifyAndConsumeAuthOtpChallenge(input: {
  challengeId: string;
  purpose: AuthOtpPurpose;
  code: string;
  userId?: string;
}): Promise<AuthOtpVerifyResult> {
  const redis = getRedis();
  const key = challengeKey(input.challengeId);
  const challenge = parseChallenge(await redis.get(key));
  if (!challenge) {
    return { ok: false, reason: "not_found" };
  }
  if (!contextMatches(challenge, input.purpose, input.userId)) {
    return { ok: false, reason: "context_mismatch" };
  }
  if (challenge.expiresAt <= Date.now()) {
    await redis.del(key);
    return { ok: false, reason: "expired" };
  }
  if (challenge.attempts >= AUTH_OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: "exhausted" };
  }

  const candidateDigest = createAuthOtpDigest(input.challengeId, input.purpose, input.code);
  const args = [
    input.purpose,
    input.userId ?? "",
    String(Date.now()),
    challenge.otpDigest,
    String(AUTH_OTP_MAX_ATTEMPTS)
  ];

  if (!digestMatches(candidateDigest, challenge.otpDigest)) {
    const result = (await redis.eval(RECORD_FAILURE_SCRIPT, 1, key, ...args)) as RedisScriptResult;
    const status = scriptStatus(result);
    if (status === "expired" || status === "exhausted" || status === "context_mismatch" || status === "not_found") {
      return { ok: false, reason: status };
    }
    return { ok: false, reason: "invalid" };
  }

  const result = (await redis.eval(CLAIM_CHALLENGE_SCRIPT, 1, key, ...args)) as RedisScriptResult;
  const status = scriptStatus(result);
  if (status !== "claimed") {
    if (status === "expired" || status === "exhausted" || status === "context_mismatch" || status === "not_found") {
      return { ok: false, reason: status };
    }
    return { ok: false, reason: "invalid" };
  }

  const claimed = parseChallenge(String(result[1] ?? ""));
  return claimed ? { ok: true, challenge: claimed } : { ok: false, reason: "not_found" };
}

const ROTATE_CHALLENGE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'not_found'} end
local ok, challenge = pcall(cjson.decode, raw)
if not ok then redis.call('DEL', KEYS[1]); return {'not_found'} end
if challenge.purpose ~= ARGV[1] then return {'context_mismatch'} end
if ARGV[2] ~= '' and challenge.userId ~= ARGV[2] then return {'context_mismatch'} end
local now = tonumber(ARGV[3])
if tonumber(challenge.expiresAt or 0) <= now then
  redis.call('DEL', KEYS[1]); return {'expired'}
end
if tonumber(challenge.attempts or 0) >= tonumber(ARGV[8]) then
  redis.call('DEL', KEYS[1]); return {'exhausted'}
end
if tonumber(challenge.sendCount or 1) >= tonumber(ARGV[9]) then return {'email_limit'} end
local waitMs = tonumber(challenge.lastSentAt or 0) + tonumber(ARGV[7]) * 1000 - now
if waitMs > 0 then return {'cooldown', tostring(math.ceil(waitMs / 1000))} end
challenge.otpDigest = ARGV[4]
challenge.issuedAt = now
challenge.lastSentAt = now
challenge.expiresAt = tonumber(ARGV[5])
challenge.sendCount = tonumber(challenge.sendCount or 1) + 1
redis.call('SET', KEYS[1], cjson.encode(challenge), 'EX', tonumber(ARGV[6]))
return {'rotated', cjson.encode(challenge)}
`;

export async function rotateAuthOtpChallenge(input: {
  challengeId: string;
  purpose: AuthOtpPurpose;
  userId?: string;
}): Promise<AuthOtpResendResult> {
  getAuthOtpSecret();
  const code = generateAuthOtpCode();
  const now = Date.now();
  const digest = createAuthOtpDigest(input.challengeId, input.purpose, code);
  const result = (await getRedis().eval(
    ROTATE_CHALLENGE_SCRIPT,
    1,
    challengeKey(input.challengeId),
    input.purpose,
    input.userId ?? "",
    String(now),
    digest,
    String(now + AUTH_OTP_EXPIRES_SECONDS * 1000),
    String(AUTH_OTP_EXPIRES_SECONDS),
    String(AUTH_OTP_RESEND_COOLDOWN_SECONDS),
    String(AUTH_OTP_MAX_ATTEMPTS),
    String(AUTH_OTP_MAX_EMAILS_PER_CHALLENGE)
  )) as RedisScriptResult;
  const status = scriptStatus(result);
  if (status !== "rotated") {
    if (status === "cooldown") {
      return { ok: false, reason: "cooldown", retryAfterSeconds: Number(result[1] ?? 1) };
    }
    if (
      status === "expired" ||
      status === "exhausted" ||
      status === "context_mismatch" ||
      status === "not_found" ||
      status === "email_limit"
    ) {
      return { ok: false, reason: status };
    }
    return { ok: false, reason: "not_found" };
  }

  const challenge = parseChallenge(String(result[1] ?? ""));
  if (!challenge) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, challenge, code, metadata: publicMetadata(input.challengeId, challenge, now) };
}
