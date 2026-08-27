import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import {
  InvalidNotificationCursorError,
  listNotificationsForUser
} from "@/lib/notifications";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(15),
  cursor: z.string().min(1).max(512).optional()
});

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid notification pagination." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await listNotificationsForUser(auth.user.id, {
        limit: parsed.data.limit,
        cursor: parsed.data.cursor
      })
    );
  } catch (error) {
    if (error instanceof InvalidNotificationCursorError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
