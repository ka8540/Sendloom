import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processProviderEvent } from "@/services/campaigns";

function verifySignature(rawBody: string, signature: string | null) {
  if (!signature || !env.RESEND_WEBHOOK_SECRET) {
    return false;
  }

  const expected = crypto.createHmac("sha256", env.RESEND_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-resend-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    type: "email.sent" | "email.delivered" | "email.bounced" | "email.complained" | "email.opened" | "email.clicked";
    data: {
      email_id: string;
    };
  };

  const eventMap = {
    "email.sent": "ACCEPTED",
    "email.delivered": "DELIVERED",
    "email.bounced": "BOUNCED",
    "email.complained": "COMPLAINED",
    "email.opened": "OPENED",
    "email.clicked": "CLICKED"
  } as const;

  await processProviderEvent({
    provider: "resend",
    providerMessageId: payload.data.email_id,
    eventType: eventMap[payload.type],
    payload: payload as unknown as Record<string, unknown>
  });

  return NextResponse.json({ success: true });
}
