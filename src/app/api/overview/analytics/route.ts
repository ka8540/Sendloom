import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getOverviewAnalytics } from "@/services/overview-analytics";
import { isAnalyticsWindow, type AnalyticsWindow } from "@/components/dashboard/analytics-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const url = new URL(request.url);
  const requestedWindow = url.searchParams.get("window");
  const window: AnalyticsWindow = isAnalyticsWindow(requestedWindow) ? requestedWindow : "30d";

  // Scoped strictly to the authenticated operator's own data.
  const analytics = await getOverviewAnalytics({ userId: auth.user.id, window });

  return NextResponse.json(analytics, {
    headers: {
      "Cache-Control": "private, no-store"
    }
  });
}
