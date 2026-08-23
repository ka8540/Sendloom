import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processLegalPolicyNotices } from "@/lib/legal-policy-notifications";

export const maxDuration = 60;

function isLegalNoticeCronAuthorized(request: Request, cronSecret = env.CRON_SECRET) {
  if (!cronSecret) return false;
  const authorization = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  return authorization === `Bearer ${cronSecret}` || secretHeader === cronSecret;
}

async function handleCron(request: Request) {
  if (!isLegalNoticeCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processLegalPolicyNotices();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[legal-notice-cron] Processor failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      {
        detectedPolicies: 0,
        baselinesCreated: 0,
        noticesCreated: 0,
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
