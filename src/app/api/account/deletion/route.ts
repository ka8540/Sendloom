import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { AccountDeletionError, deleteAccountOnly, getCurrentDeletionRequest, requestFullDeletion } from "@/services/account-deletion";

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ request: await getCurrentDeletionRequest(auth.user.id) });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `account:deletion:${auth.user.id}`, limit: 5, windowSeconds: 3600 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const body = z.object({ type: z.enum(["ACCOUNT_ONLY", "ACCOUNT_AND_OUTREACH"]) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose a deletion option." }, { status: 400 });
  try {
    const result = body.data.type === "ACCOUNT_ONLY" ? await deleteAccountOnly(auth.user.id) : await requestFullDeletion(auth.user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccountDeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[account-deletion] Request failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Deletion could not be processed. Please try again." }, { status: 500 });
  }
}
