import crypto from "node:crypto";

import jwt from "jsonwebtoken";

import { env } from "@/lib/env";

type TrackingClaims = {
  email: string;
  jobId: string;
  type: "unsubscribe" | "open" | "click";
  target?: string;
};

export function signTrackingToken(claims: TrackingClaims) {
  return jwt.sign(claims, env.SESSION_SECRET, { expiresIn: "30d" });
}

export function verifyTrackingToken(token: string) {
  return jwt.verify(token, env.SESSION_SECRET) as TrackingClaims;
}

export function safeVerifyTrackingToken(token: string) {
  try {
    const claims = verifyTrackingToken(token);
    if (
      typeof claims.email !== "string" ||
      typeof claims.jobId !== "string" ||
      !["unsubscribe", "open", "click"].includes(claims.type)
    ) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export function makeTrackingUrl(type: TrackingClaims["type"], jobId: string, email: string, target?: string) {
  const token = signTrackingToken({ type, jobId, email, target });
  if (type === "unsubscribe") {
    return `${env.APP_BASE_URL}/unsubscribe/${token}`;
  }
  if (type === "open") {
    return `${env.APP_BASE_URL}/track/open/${token}`;
  }
  return `${env.APP_BASE_URL}/track/click/${token}`;
}

export function transparentPixel() {
  return Buffer.from(
    "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64"
  );
}

export function shaKey(parts: string[]) {
  return crypto.createHash("sha256").update(parts.join(":")).digest("hex");
}
