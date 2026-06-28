import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { APP_ERROR_CATEGORIES } from "@/lib/incident/app-error";
import { INCIDENT_SEVERITIES } from "@/lib/incident/severity";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { INCIDENT_STATUSES, listAdminIncidents } from "@/services/incident-reports";

const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  reportId: z.string().min(1).max(40).optional(),
  reporter: z.string().min(1).max(24).optional(),
  feature: z.string().min(1).max(120).optional(),
  category: z.enum(APP_ERROR_CATEGORIES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `admin:incidents:list:${auth.user.id}`, limit: 120, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    reportId: searchParams.get("reportId") ?? undefined,
    reporter: searchParams.get("reporter") ?? undefined,
    feature: searchParams.get("feature") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid incident filters." }, { status: 400 });
  }

  const result = await listAdminIncidents(
    {
      reportId: parsed.data.reportId ?? null,
      reporterPseudonym: parsed.data.reporter ?? null,
      feature: parsed.data.feature ?? null,
      category: parsed.data.category ?? null,
      severity: parsed.data.severity ?? null,
      status: parsed.data.status ?? null,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null
    },
    parsed.data.cursor ?? null
  );

  return NextResponse.json(result);
}
