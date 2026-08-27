import { requireAdminApiUser } from "@/lib/api-auth";
import { productUpdateErrorResponse, productUpdateInputSchema } from "@/lib/product-updates";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/system-notice-api";
import { getAdminProductUpdate, updateProductUpdate } from "@/services/product-updates";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;

  try {
    return NextResponse.json(await getAdminProductUpdate(id));
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({
    key: `admin:product-updates:update:${auth.user.id}`,
    limit: 30,
    windowSeconds: 60
  });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  try {
    const input = productUpdateInputSchema.parse(body.body);
    const update = await updateProductUpdate(
      id,
      input,
      { id: auth.user.id, email: auth.user.email },
      request
    );
    return NextResponse.json(update);
  } catch (error) {
    return productUpdateErrorResponse(error);
  }
}
