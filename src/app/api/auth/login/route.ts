import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminUser, normalizeUserEmail, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureBootstrapData } from "@/services/seed";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  await ensureBootstrapData();
  const payload = schema.parse(await request.json());
  const email = normalizeUserEmail(payload.email);
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (user && !user.passwordHash) {
    return NextResponse.json({ error: "This account uses Google sign-in. Continue with Google instead." }, { status: 401 });
  }

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = await verifyPassword(payload.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setSession(email);
  return NextResponse.json({
    success: true,
    redirectTo: isAdminUser(user) ? "/admin" : "/workspace"
  });
}
