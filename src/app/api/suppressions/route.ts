import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { listSuppressions, suppressEmail } from "@/services/suppressions";

const schema = z.object({
  email: z.string().email(),
  reason: z.enum(["UNSUBSCRIBED", "HARD_BOUNCE", "COMPLAINT", "INVALID_EMAIL", "MANUAL_BLOCK"]),
  notes: z.string().optional()
});

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json(await listSuppressions(auth.user.id));
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const payload = schema.parse(await request.json());
  return NextResponse.json(await suppressEmail(auth.user.id, payload.email, payload.reason, "manual", payload.notes));
}
