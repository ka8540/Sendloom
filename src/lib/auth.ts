import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const SESSION_COOKIE = "mergepilot_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;

type SessionClaims = JwtPayload & {
  email: string;
};

export async function createPasswordHash(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(email: string) {
  return jwt.sign({ email }, env.SESSION_SECRET, { expiresIn: SESSION_DURATION_SECONDS });
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const claims = jwt.verify(token, env.SESSION_SECRET);
    if (typeof claims === "string" || typeof claims.email !== "string" || typeof claims.exp !== "number") {
      return null;
    }

    return claims as SessionClaims;
  } catch {
    return null;
  }
}

export async function setSession(email: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS
  });
}

export async function clearSession() {
  const store = await cookies();
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
  if (!claims?.exp) {
    return null;
  }

  return {
    email: claims.email,
    expiresAt: new Date(claims.exp * 1000).toISOString()
  };
}

export async function getSessionEmail() {
  const session = await getSession();
  return session?.email ?? null;
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
