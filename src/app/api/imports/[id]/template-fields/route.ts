import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { sanitizeDatabaseError } from "@/lib/db-error";
import { saveTemplateFields } from "@/services/imports";

const schema = z.object({
  selectedColumns: z.array(z.string()).min(1).max(10)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const payload = schema.parse(await request.json());

  try {
    const mapping = await saveTemplateFields(id, auth.user.id, payload.selectedColumns);
    return NextResponse.json(mapping);
  } catch (error) {
    const dbMessage = sanitizeDatabaseError(error, {
      operation: "POST /api/imports/[id]/template-fields",
      userId: auth.user.id
    });
    const message = dbMessage ?? (error instanceof Error ? error.message : "Could not save template fields.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
