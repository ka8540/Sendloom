import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { TEMPLATE_FORMATS } from "@/lib/templates";
import { listTemplates, upsertTemplate } from "@/services/templates";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  subject: z.string().min(1),
  format: z.enum(TEMPLATE_FORMATS),
  htmlBody: z.string().min(1),
  previewPayload: z.record(z.unknown()).optional()
});

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json(await listTemplates(auth.user.id));
}

export async function POST(request: Request) {
  const auth = await requireApiUser("templatesWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const payload = schema.parse(await request.json());
  try {
    const template = await upsertTemplate(payload, auth.user.id);
    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Template save failed."
      },
      { status: 400 }
    );
  }
}
