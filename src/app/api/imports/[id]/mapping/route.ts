import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { saveMapping } from "@/services/imports";

const schema = z.object({
  reservedFieldMap: z.record(z.string()),
  variableMap: z.record(z.string())
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const payload = schema.parse(await request.json());
  const mapping = await saveMapping(id, auth.user.id, payload.reservedFieldMap, payload.variableMap);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "mapping.saved",
    category: "MAPPING",
    target: { type: "mapping", id: mapping.id },
    message: "Saved the column mapping for an import.",
    metadata: { importId: id, mappedFields: Object.keys(payload.reservedFieldMap).length },
    request
  });

  return NextResponse.json(mapping);
}
