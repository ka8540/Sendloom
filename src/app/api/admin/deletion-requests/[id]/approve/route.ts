import { NextResponse } from "next/server";
import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { AccountDeletionError, processFullDeletion } from "@/services/account-deletion";

export const maxDuration = 180;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:deletion:approve:${auth.user.id}`, limit: 10, windowSeconds: 3600 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  try { return NextResponse.json(await processFullDeletion((await context.params).id, auth.user.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof AccountDeletionError ? error.message : "Could not process deletion." }, { status: error instanceof AccountDeletionError ? error.status : 500 }); }
}
