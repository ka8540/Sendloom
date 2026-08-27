import { NextResponse } from "next/server";
import { z } from "zod";

import { ProductUpdateActionError, ProductUpdateValidationError } from "@/lib/product-update-broadcasts";

export async function readProductUpdateJsonBody(request: Request) {
  try {
    return { ok: true as const, body: (await request.json()) as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    };
  }
}

export function productUpdateErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || "Invalid product update." },
      { status: 400 }
    );
  }
  if (error instanceof ProductUpdateValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ProductUpdateActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[product-update-api] Request failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return NextResponse.json({ error: "The product update request failed." }, { status: 500 });
}
