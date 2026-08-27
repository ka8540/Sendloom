import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const updatedCount = await markAllNotificationsRead(auth.user.id);
  return NextResponse.json({ success: true, updatedCount });
}
