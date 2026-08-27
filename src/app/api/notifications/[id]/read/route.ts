import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { markNotificationRead } from "@/lib/notifications";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id || id.length > 100) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  const marked = await markNotificationRead(auth.user.id, id);
  if (!marked) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
