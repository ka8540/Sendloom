import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processSystemNotices } from "@/lib/system-notice-notifications";

export const maxDuration = 60;

function isSystemNoticeCronAuthorized(request: Request, cronSecret = env.CRON_SECRET) {
  if (!cronSecret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${cronSecret}` ||
    request.headers.get("x-cron-secret") === cronSecret
  );
}

async function handleCron(request: Request) {
  if (!isSystemNoticeCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await processSystemNotices());
  } catch (error) {
    console.error("[system-notice-cron] Processor failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      {
        noticesDue: 0,
        noticesStarted: 0,
        noticesCompleted: 0,
        recipientsMaterialized: 0,
        recipientsSent: 0,
        recipientsRemaining: 0,
        failures: 1,
        deliveryEnabled: false
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
