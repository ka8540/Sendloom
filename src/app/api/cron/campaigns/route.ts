import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processPendingCampaignWork } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";

export const maxDuration = 60;

function isAuthorized(request: Request) {
  if (!env.CRON_SECRET) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${env.CRON_SECRET}` || secretHeader === env.CRON_SECRET;
}

async function handleCron(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let replySync = {
    repliesStored: 0,
    sendersChecked: 0,
    sendersFailed: 0
  };
  let replySyncError: string | null = null;

  try {
    replySync = await syncConnectedSenderReplies();
  } catch (error) {
    console.error("[campaign-cron] Reply sync failed.", error);
    replySyncError = error instanceof Error ? error.message : String(error);
  }

  let result: Awaited<ReturnType<typeof processPendingCampaignWork>>;

  try {
    result = await processPendingCampaignWork({
      maxDurationMs: 55_000
    });
  } catch (error) {
    console.error("[campaign-cron] Campaign processing failed.", error);

    return NextResponse.json(
      {
        dueCampaignsFound: 0,
        runsCreated: 0,
        runsProcessed: 0,
        recipientJobsProcessed: 0,
        repliesSynced: replySync.repliesStored,
        hasRemainingWork: false,
        errors: [
          {
            scope: "campaign-processing",
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      },
      { status: 500 }
    );
  }

  const errors: Array<{ scope: string; id?: string; message: string }> = [...result.errors];

  if (replySyncError || replySync.sendersFailed > 0) {
    errors.push({
      scope: "reply-sync",
      message: replySyncError ?? `${replySync.sendersFailed} sender reply sync${replySync.sendersFailed === 1 ? "" : "s"} failed.`
    });
  }

  return NextResponse.json({
    ...result,
    repliesSynced: replySync.repliesStored,
    errors,
    replySync
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
