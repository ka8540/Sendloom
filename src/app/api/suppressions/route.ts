import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { getPaginationParams } from "@/lib/pagination";
import { listSuppressionsPage, suppressEmail } from "@/services/suppressions";

const schema = z.object({
  email: z.string().email(),
  reason: z.enum(["UNSUBSCRIBED", "HARD_BOUNCE", "COMPLAINT", "INVALID_EMAIL", "MANUAL_BLOCK"]),
  notes: z.string().optional(),
  source: z.string().min(1).max(64).optional()
});

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const pagination = getPaginationParams(new URL(request.url).searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100
  });

  return NextResponse.json(await listSuppressionsPage(auth.user.id, pagination));
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const payload = schema.parse(await request.json());
  return NextResponse.json(
    await suppressEmail(auth.user.id, payload.email, payload.reason, payload.source?.trim() || "manual", payload.notes)
  );
}
