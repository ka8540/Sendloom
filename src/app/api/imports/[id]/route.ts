import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { deleteImport, updateImportName } from "@/services/imports";

const schema = z.object({
  fileName: z.string().trim().min(1).max(120)
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const payload = schema.parse(await request.json());
  const updatedImport = await updateImportName(id, auth.user.id, payload.fileName);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "import.renamed",
    category: "IMPORT",
    target: { type: "import", id: updatedImport.id, name: updatedImport.fileName },
    message: `Renamed import to ${updatedImport.fileName}.`,
    request
  });

  return NextResponse.json(updatedImport);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await deleteImport(id, auth.user.id);

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "import.deleted",
    category: "IMPORT",
    target: { type: "import", id },
    message: "Deleted an import and its dependent sequences.",
    request
  });

  return NextResponse.json(result);
}
