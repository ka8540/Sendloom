import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getImportColumns } from "@/services/imports";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const data = await getImportColumns(id, auth.user.id);
  return NextResponse.json(data);
}
