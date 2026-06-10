import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { saveHunterKeyForUser } from "@/services/hunter-keys";

const schema = z.object({
  apiKey: z.string().min(1, "Enter your Hunter API key.")
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `save-api-key:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter your Hunter API key." }, { status: 400 });
  }

  const payload = parsed.data;
  const saved = await saveHunterKeyForUser(auth.user.id, payload.apiKey);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "hunter.api_key_saved",
    category: "HUNTER",
    message: "Saved a Hunter API key.",
    metadata: { keyLast4: saved.last4 },
    request
  });

  return NextResponse.json(saved);
}
