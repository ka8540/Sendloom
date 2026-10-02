import { NextResponse } from "next/server";
import { requireAdminApiUser } from "@/lib/api-auth";
import { getDeletionRequestDetail } from "@/services/account-deletion";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;
  const detail = await getDeletionRequestDetail((await context.params).id);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
}
