import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { saveTemplateFields } from "@/services/imports";

const schema = z.object({
  selectedColumns: z.array(z.string()).min(1).max(10)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const payload = schema.parse(await request.json());

  try {
    const mapping = await saveTemplateFields(id, user.id, payload.selectedColumns);
    return NextResponse.json(mapping);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save template fields.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
