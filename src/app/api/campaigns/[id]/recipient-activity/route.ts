import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { RECIPIENT_ACTIVITY_PAGE_SIZE, buildRecipientActivityItem } from "@/lib/recipient-activity";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  if (!runId) {
    return NextResponse.json({ error: "A run is required to load recipient activity." }, { status: 400 });
  }

  // Confirm the run belongs to a campaign owned by the requesting user.
  const run = await prisma.campaignRun.findFirst({
    where: {
      id: runId,
      campaignId: id,
      campaign: { userId: auth.user.id }
    },
    select: { id: true }
  });

  if (!run) {
    return NextResponse.json({ error: "Recipient activity not found." }, { status: 404 });
  }

  const totalCount = await prisma.recipientJob.count({
    where: { campaignRunId: run.id }
  });
  const totalPages = Math.max(1, Math.ceil(totalCount / RECIPIENT_ACTIVITY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const jobs = await prisma.recipientJob.findMany({
    where: { campaignRunId: run.id },
    orderBy: { updatedAt: "desc" },
    skip: (safePage - 1) * RECIPIENT_ACTIVITY_PAGE_SIZE,
    take: RECIPIENT_ACTIVITY_PAGE_SIZE,
    select: {
      id: true,
      recipientEmail: true,
      recipientName: true,
      status: true,
      lastError: true,
      metadata: true,
      retryCount: true,
      updatedAt: true,
      nextRetryAt: true
    }
  });

  return NextResponse.json({
    page: safePage,
    pageSize: RECIPIENT_ACTIVITY_PAGE_SIZE,
    totalCount,
    totalPages,
    items: jobs.map(buildRecipientActivityItem)
  });
}
