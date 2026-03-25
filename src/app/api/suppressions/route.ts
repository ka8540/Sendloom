import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listSuppressions, suppressEmail } from "@/services/suppressions";

const schema = z.object({
  email: z.string().email(),
  reason: z.enum(["UNSUBSCRIBED", "HARD_BOUNCE", "COMPLAINT", "INVALID_EMAIL", "MANUAL_BLOCK"]),
  notes: z.string().optional()
});

export async function GET() {
  const user = await requireUser();
  return NextResponse.json(await listSuppressions(user.id));
}

export async function POST(request: Request) {
  const user = await requireUser();
  const payload = schema.parse(await request.json());
  return NextResponse.json(await suppressEmail(user.id, payload.email, payload.reason, "manual", payload.notes));
}
