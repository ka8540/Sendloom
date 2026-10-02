import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { AccountDeletionError, cancelDeletionRequest } from "@/services/account-deletion";

export async function POST() {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `account:deletion:cancel:${auth.user.id}`, limit: 5, windowSeconds: 3600 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  try { return NextResponse.json(await cancelDeletionRequest(auth.user.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof AccountDeletionError ? error.message : "Could not cancel request." }, { status: error instanceof AccountDeletionError ? error.status : 500 }); }
}
