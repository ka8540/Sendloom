import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { listPublishedProductUpdates } from "@/services/product-updates";

const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional()
});

/** User-facing feed: PUBLISHED updates only, newest first, with seen flags. */
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product update pagination." }, { status: 400 });
  }

  return NextResponse.json(await listPublishedProductUpdates(auth.user.id, parsed.data));
}
