import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const SESSION_COOKIE = "mergepilot_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_ERROR_MESSAGE = "Your session has expired. Sign in again to keep working.";
export const SESSION_TYPE = "session";
export const SESSION_AUDIENCE = "sendloom-session";

type SessionClaims = JwtPayload & {
  email: string;
  typ?: typeof SESSION_TYPE;
};

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function normalizeUserEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isConfiguredAdminEmail(email: string) {
  if (!env.ADMIN_EMAIL) {
    return false;
  }

  return normalizeUserEmail(env.ADMIN_EMAIL) === normalizeUserEmail(email);
}

// Admin authority MUST come from the DB-side `isAdmin` flag. We deliberately
// do NOT grant admin at runtime based on an email-equals-env-string check.
// The seed script (`ensureBootstrapData`) is the only path that flips the DB
// flag for the configured ADMIN_EMAIL, and that only runs at boot/login under
// known conditions. This prevents an attacker who can populate `session.email`
// (e.g., via a Google login flow that we've now also locked down) from being
// auto-promoted to admin.
export function isAdminUser(user: { email?: string; isAdmin?: boolean | null }) {
  return Boolean(user.isAdmin);
}

export async function createPasswordHash(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(email: string) {
  return jwt.sign(
    { email: normalizeUserEmail(email), typ: SESSION_TYPE },
    env.SESSION_SECRET,
    { expiresIn: SESSION_DURATION_SECONDS, audience: SESSION_AUDIENCE }
  );
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const claims = jwt.verify(token, env.SESSION_SECRET, { audience: SESSION_AUDIENCE });
    if (
      typeof claims === "string" ||
      typeof claims.email !== "string" ||
      typeof claims.exp !== "number" ||
      (claims as SessionClaims).typ !== SESSION_TYPE
    ) {
      return null;
    }

    return claims as SessionClaims;
  } catch {
    return null;
  }
}

export async function setSession(email: string) {
  const normalizedEmail = normalizeUserEmail(email);
  const token = createSessionToken(normalizedEmail);
  const claims = verifySessionToken(token);
  const now = new Date();
  const issuedAt = claims?.iat ? new Date(claims.iat * 1000) : new Date(Math.floor(now.getTime() / 1000) * 1000);
  const expiresAt = claims?.exp ? new Date(claims.exp * 1000) : new Date(issuedAt.getTime() + SESSION_DURATION_SECONDS * 1000);

  await prisma.user.update({
    where: { email: normalizedEmail },
    data: {
      // isAdmin is NOT set here — admin status only flips via the bootstrap
      // seed (`ensureBootstrapData`) on login when ADMIN_PASSWORD is provided.
      lastLoginAt: now,
      lastSeenAt: now,
      sessionIssuedAt: issuedAt,
      sessionExpiresAt: expiresAt
    }
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS
  });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  // Best-effort revoke ALL sessions for this user (advances sessionIssuedAt
  // so older JWTs fail the freshness check). We decode without verifying so
  // that even an expired-but-recent cookie still triggers DB-side revocation.
  if (token) {
    try {
      const decoded = jwt.decode(token) as JwtPayload | string | null;
      const email =
        decoded && typeof decoded === "object" && typeof decoded.email === "string"
          ? (decoded.email as string)
          : null;
      if (email) {
        await prisma.user.updateMany({
          where: { email: normalizeUserEmail(email) },
          data: {
            sessionIssuedAt: new Date(),
            sessionExpiresAt: null
          }
        });
      }
    } catch {
      // Ignore — we still want to clear the cookie below.
    }
  }

  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const claims = verifySessionToken(token);
  if (!claims?.exp || !claims.email) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: claims.email },
    select: {
      email: true,
      eligibilityBlockedAt: true,
      sessionExpiresAt: true,
      sessionIssuedAt: true,
      lastSeenAt: true
    }
  });

  if (!user) {
    return null;
  }

  if (user.eligibilityBlockedAt) {
    return null;
  }

  const tokenIssuedAt = typeof claims.iat === "number" ? new Date(claims.iat * 1000) : null;
  const tokenExpiresAt = new Date(claims.exp * 1000);
  const now = new Date();
  let sessionExpiresAt = user.sessionExpiresAt;

  if (!user.sessionIssuedAt && !user.sessionExpiresAt) {
    await prisma.user.updateMany({
      where: { email: user.email },
      data: {
        sessionIssuedAt: tokenIssuedAt ?? now,
        sessionExpiresAt: tokenExpiresAt,
        lastSeenAt: now
      }
    });
    sessionExpiresAt = tokenExpiresAt;
  }

  if (user.sessionIssuedAt && !tokenIssuedAt) {
    return null;
  }

  if (user.sessionIssuedAt && tokenIssuedAt && tokenIssuedAt < user.sessionIssuedAt) {
    return null;
  }

  if (!sessionExpiresAt || sessionExpiresAt <= now || tokenExpiresAt <= now) {
    return null;
  }

  if (!user.lastSeenAt || now.getTime() - user.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await prisma.user.updateMany({
      where: { email: user.email },
      data: {
        lastSeenAt: now
      }
    });
  }

  return {
    email: user.email,
    expiresAt: sessionExpiresAt.toISOString()
  };
}

export async function getSessionEmail() {
  const session = await getSession();
  return session?.email ?? null;
}

// Used by the public landing/login/signup pages: if the visitor already has a
// valid, non-expired session, send them straight to their workspace instead of
// re-showing the marketing/auth flow. Session validity is decided by
// `getSession()` (JWT signature + DB freshness/expiry), so a stale, revoked, or
// expired cookie falls through and the public page renders for logged-out
// visitors. Never redirects protected routes back to public ones, so no loop.
export async function redirectAuthenticatedToWorkspace() {
  const session = await getSession();
  if (session) {
    redirect("/workspace");
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function getSessionUser() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: { email: session.email }
  });
}

export async function requireUser() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { email: session.email }
  });

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireOperatorUser() {
  const user = await requireUser();

  if (isAdminUser(user)) {
    redirect("/admin");
  }

  return user;
}

export async function requireAdminUser() {
  const user = await requireUser();

  if (!isAdminUser(user)) {
    redirect("/workspace");
  }

  return user;
}
