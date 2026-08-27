import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse } from "@/lib/product-update-api";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { cancelProductUpdateBroadcast } from "@/services/product-update-broadcasts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:cancel:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  try {
    const { id } = await context.params;
    return NextResponse.json(
      await cancelProductUpdateBroadcast(id, { id: auth.user.id, email: auth.user.email }, request)
    );
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
