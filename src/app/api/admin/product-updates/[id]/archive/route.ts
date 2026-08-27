import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse } from "@/lib/product-updates";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { archiveProductUpdate } from "@/services/product-updates";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({
    key: `admin:product-updates:archive:${auth.user.id}`,
    limit: 10,
    windowSeconds: 60
  });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;

  try {
    const update = await archiveProductUpdate(id, { id: auth.user.id, email: auth.user.email }, request);
    return NextResponse.json(update);
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
