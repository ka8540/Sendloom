import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SEGMENT_SEPARATOR = ".";

function getEncryptionKey() {
  // Hunter keys must NOT share an encryption key with session JWTs. In
  // production env validation requires HUNTER_KEY_ENCRYPTION_SECRET; in dev
  // we fall back to SESSION_SECRET only to keep local bootstrapping painless.
  const secret = env.HUNTER_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("HUNTER_KEY_ENCRYPTION_SECRET is required in production.");
    }
    return createHash("sha256").update(env.SESSION_SECRET).digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptHunterApiKey(input: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  const encrypted = Buffer.concat([cipher.update(input, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(SEGMENT_SEPARATOR);
}

export function decryptHunterApiKey(payload: string) {
  const [ivSegment, authTagSegment, encryptedSegment] = payload.split(SEGMENT_SEPARATOR);

  if (!ivSegment || !authTagSegment || !encryptedSegment) {
    throw new Error("Stored Hunter API key is malformed.");
  }

  const iv = Buffer.from(ivSegment, "base64url");
  const authTag = Buffer.from(authTagSegment, "base64url");
  const encrypted = Buffer.from(encryptedSegment, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskHunterApiKey(input: string) {
  return input.slice(-4);
}
