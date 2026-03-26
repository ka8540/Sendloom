import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { getImportColumns } from "@/services/imports";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const data = await getImportColumns(id, user.id);
  return NextResponse.json(data);
}
