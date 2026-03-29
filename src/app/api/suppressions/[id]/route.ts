import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { deleteSuppression } from "@/services/suppressions";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const deleted = await deleteSuppression(auth.user.id, id);

  if (!deleted) {
    return NextResponse.json(
      {
        error: "Suppression not found."
      },
      { status: 404 }
    );
  }

  return NextResponse.json(deleted);
}
