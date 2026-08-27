import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { countUnseenProductUpdates } from "@/services/product-updates";

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json({ count: await countUnseenProductUpdates(auth.user.id) });
}
