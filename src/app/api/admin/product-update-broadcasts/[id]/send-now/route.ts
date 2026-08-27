import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, readProductUpdateJsonBody } from "@/lib/product-update-api";
import { sendNowProductUpdateBroadcastSchema } from "@/lib/product-update-broadcasts";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { requestProductUpdateSendNow } from "@/services/product-update-broadcasts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:send-now:${auth.user.id}`, limit: 3, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const body = await readProductUpdateJsonBody(request);
  if (!body.ok) return body.response;
  try {
    sendNowProductUpdateBroadcastSchema.parse(body.body);
    const { id } = await context.params;
    return NextResponse.json(
      await requestProductUpdateSendNow(id, { id: auth.user.id, email: auth.user.email }, request)
    );
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
