import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, productUpdateSeenSchema } from "@/lib/product-updates";
import { readJsonBody } from "@/lib/system-notice-api";
import { markProductUpdatesSeen } from "@/services/product-updates";

/**
 * Idempotent bulk seen write for the What's New page. The user id comes only
 * from the authenticated session — the body carries update ids and nothing else.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  try {
    const { ids } = productUpdateSeenSchema.parse(body.body);
    return NextResponse.json(await markProductUpdatesSeen(auth.user.id, ids));
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
