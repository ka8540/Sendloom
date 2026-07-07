import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getAccountOverview } from "@/services/account";

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const overview = await getAccountOverview(auth.user.id, auth.user);
  return NextResponse.json(overview);
}
