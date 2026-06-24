import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { sanitizeDatabaseError } from "@/lib/db-error";
import { HunterApiError, findHunterEmail } from "@/lib/hunter";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { getDecryptedHunterKeyForUser } from "@/services/hunter-keys";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name."),
  lastName: z.string().trim().min(1, "Enter a last name."),
  domain: z.string().trim().min(1, "Enter a company domain.")
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `email-finder:user:${auth.user.id}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a first name, last name, and domain." }, { status: 400 });
  }

  const payload = parsed.data;
  const apiKey = await getDecryptedHunterKeyForUser(auth.user.id);

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Save your Hunter API key in Settings before searching."
      },
      { status: 400 }
    );
  }

  try {
    const results = await findHunterEmail(apiKey, payload.firstName, payload.lastName, payload.domain);

    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "hunter.email_search",
      category: "HUNTER",
      message: `Searched Hunter for an email at ${payload.domain}.`,
      metadata: { domain: payload.domain, found: Boolean(results?.length) },
      request
    });

    return NextResponse.json({ results });
  } catch (error) {
    const dbMessage = sanitizeDatabaseError(error, { operation: "POST /api/email-finder", userId: auth.user.id });
    const message = dbMessage ?? (error instanceof Error ? error.message : "Email finder request failed.");
    const status = error instanceof HunterApiError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
