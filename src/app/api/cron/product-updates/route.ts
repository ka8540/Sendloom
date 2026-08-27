import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processProductUpdateBroadcasts } from "@/lib/product-update-notifications";

export const maxDuration = 60;

function isProductUpdateCronAuthorized(request: Request, cronSecret = env.CRON_SECRET) {
  return Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
}

async function handleCron(request: Request) {
  if (!isProductUpdateCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await processProductUpdateBroadcasts());
  } catch (error) {
    console.error("[product-update-cron] Processor failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      {
        broadcastsDue: 0,
        broadcastsStarted: 0,
        broadcastsCompleted: 0,
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
