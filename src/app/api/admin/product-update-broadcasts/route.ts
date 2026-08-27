import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, readProductUpdateJsonBody } from "@/lib/product-update-api";
import { productUpdateBroadcastInputSchema } from "@/lib/product-update-broadcasts";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { createProductUpdateBroadcast, listProductUpdateBroadcasts } from "@/services/product-update-broadcasts";

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:list:${auth.user.id}`, limit: 120, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  return NextResponse.json(await listProductUpdateBroadcasts());
}

export async function POST(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:create:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const body = await readProductUpdateJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const input = productUpdateBroadcastInputSchema.parse(body.body);
    return NextResponse.json(
      await createProductUpdateBroadcast(input, { id: auth.user.id, email: auth.user.email }, request),
      { status: 201 }
    );
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
