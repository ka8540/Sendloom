import { NextResponse } from "next/server";

import { isAnalysisPage, normalizeAnalysisDateRange } from "@/lib/analysis";
import { requireApiUser } from "@/lib/api-auth";
import { getAnalysisPageData } from "@/services/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ page: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;

  const { page } = await context.params;
  if (!isAnalysisPage(page)) {
    return NextResponse.json({ error: "Unknown Analysis page." }, { status: 404 });
  }

  const url = new URL(request.url);
  const range = normalizeAnalysisDateRange({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to")
  });

  try {
    const data = await getAnalysisPageData({ userId: auth.user.id, page, range });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    console.error("[analysis] Failed to aggregate page.", { page, userId: auth.user.id, error });
    return NextResponse.json(
      { error: "We couldn't load Analysis for this date range. Please try again." },
      { status: 500 }
    );
  }
}
