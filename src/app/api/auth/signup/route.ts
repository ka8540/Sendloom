import { NextResponse } from "next/server";
import { z } from "zod";

import { createPasswordHash, normalizeUserEmail, setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      isAdmin: process.env.ADMIN_EMAIL?.trim().toLowerCase() === email
    }
  });

  await setSession(user.email);
  return NextResponse.json({ success: true });
}
