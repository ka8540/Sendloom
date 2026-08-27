import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, readProductUpdateJsonBody } from "@/lib/product-update-api";
import { productUpdateBroadcastInputSchema } from "@/lib/product-update-broadcasts";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { getProductUpdateBroadcast, updateProductUpdateBroadcast } from "@/services/product-update-broadcasts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const broadcast = await getProductUpdateBroadcast(id);
  return broadcast
    ? NextResponse.json(broadcast)
    : NextResponse.json({ error: "Product update not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:update:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const body = await readProductUpdateJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const input = productUpdateBroadcastInputSchema.parse(body.body);
    const { id } = await context.params;
    return NextResponse.json(
      await updateProductUpdateBroadcast(id, input, { id: auth.user.id, email: auth.user.email }, request)
    );
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
