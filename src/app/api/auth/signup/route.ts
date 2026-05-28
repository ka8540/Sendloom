import { NextResponse } from "next/server";
import { z } from "zod";

import { createPasswordHash, normalizeUserEmail, setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, getClientIp, rateLimit } from "@/lib/rate-limit";

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = await rateLimit({ key: `auth:signup:ip:${ip}`, limit: 5, windowSeconds: 60 * 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const payload = schema.parse(await request.json());
  const email = normalizeUserEmail(payload.email);
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser?.passwordHash) {
    return NextResponse.json({ error: "An account with that email already exists. Sign in instead." }, { status: 409 });
  }

  if (existingUser && !existingUser.passwordHash) {
    return NextResponse.json(
      { error: "That email already has a Google-based account. Continue with Google to sign in." },
      { status: 409 }
    );
  }

  const passwordHash = await createPasswordHash(payload.password);
  // Admin status is bootstrapped only via `ensureBootstrapData` (which runs on
  // login when ADMIN_EMAIL + ADMIN_PASSWORD are set). Signup never grants
  // admin to prevent privilege escalation from a guessable email match.
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash
    }
  });

  await setSession(user.email);
  return NextResponse.json({ success: true });
}
