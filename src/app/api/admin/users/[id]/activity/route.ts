import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES } from "@/lib/audit";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { listUserActivityEvents } from "@/services/admin-activity";

const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  type: z.string().min(1).max(40).optional(),
  q: z.string().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `admin:users:activity:${auth.user.id}`, limit: 120, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    type: searchParams.get("type") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid activity filters." }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await listUserActivityEvents({
    userId: id,
    cursor: parsed.data.cursor ?? null,
    category: parsed.data.category ?? null,
    severity: parsed.data.severity ?? null,
    targetType: parsed.data.type ?? null,
    search: parsed.data.q ?? null,
    from: parsed.data.from ?? null,
    to: parsed.data.to ?? null
  });

  if (!result) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json(result);
}
