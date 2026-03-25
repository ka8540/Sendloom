import { NextResponse } from "next/server";
import { z } from "zod";

import { setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureBootstrapData } from "@/services/seed";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  await ensureBootstrapData();
  const payload = schema.parse(await request.json());
  const user = await prisma.user.findUnique({
    where: { email: payload.email }
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = await verifyPassword(payload.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  await setSession(user.email);
  return NextResponse.json({ success: true });
}
