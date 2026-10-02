import { NextResponse } from "next/server";
import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { listDeletionRequests } from "@/services/account-deletion";

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:deletion:list:${auth.user.id}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const url = new URL(request.url);
  const parseDate = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined;
  const toParam = url.searchParams.get("to");
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? new Date(`${toParam}T23:59:59.999Z`) : parseDate(toParam);
  return NextResponse.json(await listDeletionRequests({ status: url.searchParams.get("status") ?? undefined, from: parseDate(url.searchParams.get("from")), to, page: Number(url.searchParams.get("page")) || 1 }));
}
