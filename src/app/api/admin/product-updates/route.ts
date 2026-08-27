import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, productUpdateInputSchema } from "@/lib/product-updates";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/system-notice-api";
import { createProductUpdate, listAdminProductUpdates } from "@/services/product-updates";

const querySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export async function GET(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({
    key: `admin:product-updates:list:${auth.user.id}`,
    limit: 120,
    windowSeconds: 60
  });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product update pagination." }, { status: 400 });
  }

  return NextResponse.json(await listAdminProductUpdates(parsed.data));
}

export async function POST(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({
    key: `admin:product-updates:create:${auth.user.id}`,
    limit: 10,
    windowSeconds: 60
  });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  try {
    const input = productUpdateInputSchema.parse(body.body);
    const update = await createProductUpdate(
      input,
      { id: auth.user.id, email: auth.user.email },
      request
    );
    return NextResponse.json(update, { status: 201 });
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
