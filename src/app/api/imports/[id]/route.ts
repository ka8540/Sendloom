import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { deleteImport, updateImportName } from "@/services/imports";

const schema = z.object({
  fileName: z.string().trim().min(1).max(120)
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const payload = schema.parse(await request.json());
  const updatedImport = await updateImportName(id, user.id, payload.fileName);
  return NextResponse.json(updatedImport);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const result = await deleteImport(id, user.id);
  return NextResponse.json(result);
}
