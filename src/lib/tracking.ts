import crypto from "node:crypto";

import jwt from "jsonwebtoken";

import { env } from "@/lib/env";

export const TRACKING_AUDIENCE = "sendloom-tracking";
export const TRACKING_TYPE = "tracking";
export type TrackingChannel = "open" | "click" | "unsubscribe";

type TrackingClaims = {
  email: string;
  jobId: string;
  type: TrackingChannel;
  target?: string;
  typ?: typeof TRACKING_TYPE;
  aud?: typeof TRACKING_AUDIENCE;
};

export class InvalidTrackingTokenError extends Error {
  constructor(message = "Invalid tracking token.") {
    super(message);
    this.name = "InvalidTrackingTokenError";
  }
}

function getTrackingSecret() {
  // Tracking tokens MUST be signed with a key independent of SESSION_SECRET so
  // that a leaked tracking token (which is embedded in every sent email and is
  // therefore not a secret) cannot be replayed as a session cookie. In
  // production env validation enforces presence of TRACKING_SECRET; in dev we
  // fall back to SESSION_SECRET only when TRACKING_SECRET is unset, because
  // dev does not enforce email delivery.
  return env.TRACKING_SECRET ?? env.SESSION_SECRET;
}

export function signTrackingToken(claims: { email: string; jobId: string; type: TrackingChannel; target?: string }) {
  return jwt.sign(
    {
      email: claims.email,
      jobId: claims.jobId,
      type: claims.type,
      target: claims.target,
      typ: TRACKING_TYPE
    },
    getTrackingSecret(),
    { expiresIn: "30d", audience: TRACKING_AUDIENCE }
  );
}

export function verifyTrackingToken(token: string, expectedChannel?: TrackingChannel): TrackingClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, getTrackingSecret(), { audience: TRACKING_AUDIENCE });
  } catch {
    throw new InvalidTrackingTokenError();
  }

  if (!decoded || typeof decoded === "string" || typeof decoded !== "object") {
    throw new InvalidTrackingTokenError();
  }

  const claims = decoded as TrackingClaims;

  if (claims.typ !== TRACKING_TYPE) {
    throw new InvalidTrackingTokenError();
  }

  if (claims.type !== "open" && claims.type !== "click" && claims.type !== "unsubscribe") {
    throw new InvalidTrackingTokenError();
  }

  if (typeof claims.email !== "string" || typeof claims.jobId !== "string") {
    throw new InvalidTrackingTokenError();
  }

  if (expectedChannel && claims.type !== expectedChannel) {
    throw new InvalidTrackingTokenError();
  }

  return claims;
}

export function makeTrackingUrl(type: TrackingChannel, jobId: string, email: string, target?: string) {
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
