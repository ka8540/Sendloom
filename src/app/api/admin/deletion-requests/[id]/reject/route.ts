import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { AccountDeletionError, rejectDeletionRequest } from "@/services/account-deletion";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:deletion:reject:${auth.user.id}`, limit: 10, windowSeconds: 3600 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const parsed = z.object({ note: z.string().trim().min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A review note is required." }, { status: 400 });
  const { id } = await context.params;
  try {
    const result = await rejectDeletionRequest(id, auth.user.id, parsed.data.note);
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof AccountDeletionError ? error.message : "Could not reject request." }, { status: error instanceof AccountDeletionError ? error.status : 500 }); }
}
