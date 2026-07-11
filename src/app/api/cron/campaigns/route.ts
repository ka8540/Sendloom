import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  renewExpiringGmailWatches,
  repairHardBouncedRecipientDispositions,
  syncDueSenderBounces
} from "@/services/bounces";
import { processPendingCampaignWork } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";
import {
  type AutomaticBounceCheckResult,
  runAutomaticSequenceBounceChecks
} from "@/services/sequence-bounce-monitor";

export const maxDuration = 60;

function isAuthorized(request: Request) {
  if (!env.CRON_SECRET) {
    // Fail closed in production. Env validation also rejects production
    // startup with no CRON_SECRET, but this is the second line of defence.
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${env.CRON_SECRET}` || secretHeader === env.CRON_SECRET;
}

async function handleCron(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        repliesSynced: 0,
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

  let replySync = {
    repliesStored: 0,
    sendersChecked: 0,
    sendersFailed: 0
  };
  const errors: Array<{ scope: string; id?: string; message: string }> = [...result.errors];

  try {
    replySync = await syncConnectedSenderReplies();
  } catch (error) {
    console.error("[campaign-cron] Reply sync failed.", error);
    errors.push({
      scope: "reply-sync",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  // Gmail bounce monitoring: keep mailbox watches alive (they expire ~weekly;
  // this no-ops when nothing is due) and run the incremental history sync as a
  // fallback for missed Pub/Sub pushes. Failures here never block sending.
  let watchRenewal = { sendersChecked: 0, renewed: 0, failed: 0 };
  let bounceSync = { sendersChecked: 0, processedBounces: 0, sendersFailed: 0 };
  try {
    watchRenewal = await renewExpiringGmailWatches();
  } catch (error) {
    console.error("[campaign-cron] Gmail watch renewal failed.", error);
    errors.push({
      scope: "gmail-watch-renewal",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  try {
    bounceSync = await syncDueSenderBounces();
  } catch (error) {
    console.error("[campaign-cron] Bounce sync failed.", error);
    errors.push({
      scope: "bounce-sync",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  // Idempotent disposition repair: recipients recorded as FAILED by the older
  // bounce mapping become Skipped (SUPPRESSED). No-ops once converged.
  let dispositionRepair = { repairedCount: 0 };
  try {
    dispositionRepair = await repairHardBouncedRecipientDispositions();
  } catch (error) {
    console.error("[campaign-cron] Bounce disposition repair failed.", error);
    errors.push({
      scope: "bounce-disposition-repair",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  // Automatic per-sequence bounce monitoring: while a run is sending (and
  // briefly after it completes) run the same shared check the manual "Check
  // bounces" button uses, on a per-run cadence checkpoint. Deliberately last:
  // send work always comes first, and a monitoring failure never blocks it.
  let bounceMonitor: AutomaticBounceCheckResult | null = null;
  try {
    bounceMonitor = await runAutomaticSequenceBounceChecks();
  } catch (error) {
    console.error("[campaign-cron] Automatic sequence bounce monitoring failed.", error);
    errors.push({
      scope: "sequence-bounce-monitor",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return NextResponse.json({
    ...result,
    repliesSynced: replySync.repliesStored,
    errors,
    replySync,
    watchRenewal,
    bounceSync,
    dispositionRepair,
    bounceMonitor
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
