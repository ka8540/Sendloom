import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { getSystemHealth } from "@/lib/system-health";

export async function GET() {
  const auth = await requireAdminApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json(await getSystemHealth());
}
