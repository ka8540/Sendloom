import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { productUpdateErrorResponse, readProductUpdateJsonBody } from "@/lib/product-update-api";
import { productUpdateBroadcastInputSchema } from "@/lib/product-update-broadcasts";
import { renderProductUpdateEmail } from "@/lib/product-update-email";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const limit = await rateLimit({ key: `admin:product-updates:preview:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);
  const body = await readProductUpdateJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const broadcast = productUpdateBroadcastInputSchema.parse(body.body);
    return NextResponse.json(renderProductUpdateEmail({ broadcast, appBaseUrl: env.APP_BASE_URL }));
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
