import { createHash, randomBytes } from "node:crypto";

import { getRedis } from "@/lib/redis";

export const PASSWORD_RESET_GRANT_EXPIRES_SECONDS = 10 * 60;

type PasswordResetGrantRecord = {
  version: 1;
  purpose: "PASSWORD_RESET";
  userId: string;
  normalizedEmail: string;
  issuedAt: number;
  expiresAt: number;
};

export type PasswordResetGrantConsumeResult =
  | { ok: true; grant: PasswordResetGrantRecord }
  | { ok: false; reason: "invalid" | "expired" };

const GRANT_PREFIX = "auth:password-reset:grant";

export function createPasswordResetGrantDigest(resetGrant: string) {
  return createHash("sha256").update(resetGrant, "utf8").digest("hex");
}

function grantKey(resetGrant: string) {
  return `${GRANT_PREFIX}:${createPasswordResetGrantDigest(resetGrant)}`;
}

function parseGrant(raw: string | null): PasswordResetGrantRecord | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<PasswordResetGrantRecord>;
    if (
      value.version !== 1 ||
      value.purpose !== "PASSWORD_RESET" ||
      typeof value.userId !== "string" ||
      typeof value.normalizedEmail !== "string" ||
      typeof value.issuedAt !== "number" ||
      typeof value.expiresAt !== "number"
    ) {
      return null;
    }
    return value as PasswordResetGrantRecord;
  } catch {
    return null;
  }
}

export async function createPasswordResetGrant(input: { userId: string; normalizedEmail: string }) {
  const resetGrant = randomBytes(32).toString("base64url");
  const now = Date.now();
  const record: PasswordResetGrantRecord = {
    version: 1,
    purpose: "PASSWORD_RESET",
    userId: input.userId,
    normalizedEmail: input.normalizedEmail,
    issuedAt: now,
    expiresAt: now + PASSWORD_RESET_GRANT_EXPIRES_SECONDS * 1000
  };

  await getRedis().set(
    grantKey(resetGrant),
    JSON.stringify(record),
    "EX",
    PASSWORD_RESET_GRANT_EXPIRES_SECONDS
  );
  return { resetGrant, expiresInSeconds: PASSWORD_RESET_GRANT_EXPIRES_SECONDS };
}

const CLAIM_GRANT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'invalid'} end
local ok, grant = pcall(cjson.decode, raw)
if not ok then redis.call('DEL', KEYS[1]); return {'invalid'} end
if tonumber(grant.version or 0) ~= 1 or grant.purpose ~= 'PASSWORD_RESET' then
  redis.call('DEL', KEYS[1]); return {'invalid'}
end
if tonumber(grant.expiresAt or 0) <= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1]); return {'expired'}
end
redis.call('DEL', KEYS[1])
return {'claimed', raw}
`;

export async function consumePasswordResetGrant(resetGrant: string): Promise<PasswordResetGrantConsumeResult> {
  const result = (await getRedis().eval(
    CLAIM_GRANT_SCRIPT,
    1,
    grantKey(resetGrant),
    String(Date.now())
  )) as Array<string | number>;
  const status = String(result[0] ?? "invalid");
  if (status !== "claimed") {
    return { ok: false, reason: status === "expired" ? "expired" : "invalid" };
  }

  const grant = parseGrant(String(result[1] ?? ""));
  return grant ? { ok: true, grant } : { ok: false, reason: "invalid" };
}
