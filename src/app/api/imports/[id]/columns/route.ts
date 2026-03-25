import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getImportColumns } from "@/services/imports";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const data = await getImportColumns(id, user.id);
  return NextResponse.json(data);
}
