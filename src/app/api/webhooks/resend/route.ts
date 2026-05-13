import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processProviderEvent } from "@/services/campaigns";

type ResendWebhookPayload = {
  type: "email.sent" | "email.delivered" | "email.bounced" | "email.complained" | "email.opened" | "email.clicked";
  data: {
    email_id: string;
  };
};

function verifySignature(rawBody: string, signature: string | null) {
  if (!signature || !env.RESEND_WEBHOOK_SECRET) {
    return false;
  }

  const expected = crypto.createHmac("sha256", env.RESEND_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-resend-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: ResendWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const eventMap = {
    "email.sent": "ACCEPTED",
    "email.delivered": "DELIVERED",
    "email.bounced": "BOUNCED",
    "email.complained": "COMPLAINED",
    "email.opened": "OPENED",
    "email.clicked": "CLICKED"
  } as const;
  const eventType = eventMap[payload.type];

  if (!eventType || typeof payload.data?.email_id !== "string") {
    return NextResponse.json({ error: "Unsupported webhook payload." }, { status: 400 });
  }

  await processProviderEvent({
    provider: "resend",
    providerMessageId: payload.data.email_id,
    eventType,
    payload: payload as unknown as Record<string, unknown>
  });

  return NextResponse.json({ success: true });
}
