import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { sanitizeDatabaseError } from "@/lib/db-error";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
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

  const limit = await rateLimit({ key: `templates:write:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const payload = schema.parse(await request.json());
  try {
    const template = await upsertTemplate(payload, auth.user.id);

    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: payload.id ? "template.updated" : "template.created",
      category: "TEMPLATE",
      severity: payload.id ? "INFO" : "SUCCESS",
      target: { type: "template", id: template.id, name: template.name },
      message: payload.id ? `Updated template ${template.name}.` : `Created template ${template.name}.`,
      metadata: { format: template.format, version: template.version },
      request
    });

    return NextResponse.json(template);
  } catch (error) {
    // Sanitize Prisma/database errors so table, column, and constraint internals
    // never reach the client; app-authored validation messages still pass through.
    const dbMessage = sanitizeDatabaseError(error, { operation: "POST /api/templates", userId: auth.user.id });
    return NextResponse.json(
      {
        error: dbMessage ?? (error instanceof Error ? error.message : "Template save failed.")
      },
      { status: 400 }
    );
  }
}
