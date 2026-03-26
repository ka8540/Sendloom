import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { saveMapping } from "@/services/imports";

const schema = z.object({
  reservedFieldMap: z.record(z.string()),
  variableMap: z.record(z.string())
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id } = await context.params;
  const payload = schema.parse(await request.json());
  const mapping = await saveMapping(id, user.id, payload.reservedFieldMap, payload.variableMap);
  return NextResponse.json(mapping);
}
