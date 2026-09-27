import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getDiscoverDashboardLiveSnapshot } from "@/lib/discover-dashboard-live";

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;

  return NextResponse.json(await getDiscoverDashboardLiveSnapshot(auth.user.id));
}
