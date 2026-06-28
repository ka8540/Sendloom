// Privacy-preserving reporter identity for incident reports. SERVER-ONLY: this
// module reads server secrets and must never be imported into a client bundle
// (it is only used by the incident service / API routes).
//
// Two derivations, both keyed by dedicated server secrets — never the email,
// never a plain unsalted hash, never the raw database user id:
//   1. reporterPseudonym(userId) — a STABLE, non-reversible HMAC code shown to
//      admins (e.g. U-7F2A-91C4). Same user -> same code; different users ->
//      different codes; not generable without REPORT_PSEUDONYM_SECRET.
//   2. encryptReporterRef(userId) — an AES-256-GCM (authenticated) ciphertext of
//      the user id for INTERNAL follow-up only. Stored as ciphertext + iv + tag;
//      never returned to any client (admin DTOs omit the encrypted columns).
//
// Key derivation mirrors src/lib/hunter-crypto.ts: a dedicated production secret,
// with a dev-only fallback to SESSION_SECRET so local bootstrapping is painless.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getPseudonymSecret(): string {
  const secret = env.REPORT_PSEUDONYM_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("REPORT_PSEUDONYM_SECRET is required in production.");
  }
  // Dev fallback only — keeps local bootstrapping painless. The pseudonym is
  // still keyed (HMAC), never a bare SHA-256 of the user id.
  return env.SESSION_SECRET;
}

function getIdentityKey(): Buffer {
  const secret = env.REPORT_IDENTITY_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("REPORT_IDENTITY_ENCRYPTION_KEY is required in production.");
    }
    return createHash("sha256").update(env.SESSION_SECRET).digest();
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Stable anonymous reporter code, e.g. `U-7F2A-91C4`. Deterministic for a given
 * user id, but not reversible to the user id without REPORT_PSEUDONYM_SECRET.
 * This is the ONLY identity an admin ever sees.
 */
export function reporterPseudonym(userId: string): string {
  const digest = createHmac("sha256", getPseudonymSecret()).update(userId).digest("hex");
  const first = digest.slice(0, 4).toUpperCase();
  const second = digest.slice(4, 8).toUpperCase();
  return `U-${first}-${second}`;
}

export type EncryptedReporterRef = {
  ciphertext: string;
  iv: string;
  tag: string;
};

/**
 * Authenticated-encrypt the raw user id for internal follow-up. Each call uses a
 * fresh random IV, so encrypting the same user twice yields different ciphertext.
 */
export function encryptReporterRef(userId: string): EncryptedReporterRef {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getIdentityKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(userId, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url")
  };
}

/**
 * Decrypt a stored reporter reference. Tampered ciphertext/iv/tag fails GCM
 * authentication and throws. SERVER-ONLY and intentionally NOT imported by any
 * admin-facing DTO/route path — there is no admin "reveal identity" action.
 */
export function decryptReporterRef(ref: EncryptedReporterRef): string {
  const iv = Buffer.from(ref.iv, "base64url");
  const tag = Buffer.from(ref.tag, "base64url");
  const encrypted = Buffer.from(ref.ciphertext, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", getIdentityKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
