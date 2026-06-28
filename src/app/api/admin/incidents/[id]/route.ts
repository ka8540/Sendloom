import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import {
  INCIDENT_STATUSES,
  addIncidentAdminNote,
  getAdminIncidentDetail,
  recordIncidentViewed,
  updateIncidentStatus
} from "@/services/incident-reports";

const patchSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    note: z.string().min(1).max(2000).optional()
  })
  .strict()
  .refine((value) => value.status !== undefined || value.note !== undefined, {
    message: "Provide a status change or a note."
  });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const detail = await getAdminIncidentDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Incident not found." }, { status: 404 });
  }

  await recordIncidentViewed(id, { id: auth.user.id, email: auth.user.email }, request);
  return NextResponse.json(detail);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `admin:incidents:write:${auth.user.id}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid incident update." }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = { id: auth.user.id, email: auth.user.email };

  let detail = await getAdminIncidentDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Incident not found." }, { status: 404 });
  }

  if (parsed.data.status) {
    detail = (await updateIncidentStatus(id, parsed.data.status, admin, request)) ?? detail;
  }
  if (parsed.data.note) {
    detail = (await addIncidentAdminNote(id, parsed.data.note, admin, request)) ?? detail;
  }

  return NextResponse.json(detail);
}
