import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { saveHunterKeyForUser } from "@/services/hunter-keys";

const schema = z.object({
  apiKey: z.string().min(1, "Enter your Hunter API key.")
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter your Hunter API key." }, { status: 400 });
  }

  const payload = parsed.data;
  const saved = await saveHunterKeyForUser(auth.user.id, payload.apiKey);

  return NextResponse.json(saved);
}
