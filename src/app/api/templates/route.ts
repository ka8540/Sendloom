import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listTemplates, upsertTemplate } from "@/services/templates";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
  previewPayload: z.record(z.unknown()).optional()
});

export async function GET() {
  const user = await requireUser();
  return NextResponse.json(await listTemplates(user.id));
}

export async function POST(request: Request) {
  const user = await requireUser();
  const payload = schema.parse(await request.json());
  const template = await upsertTemplate(payload, user.id);
  return NextResponse.json(template);
}
