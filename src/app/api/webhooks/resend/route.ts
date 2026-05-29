import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processProviderEvent } from "@/services/campaigns";

// Max replay window for Resend webhook timestamps. Resend doesn't currently
// document a standard timestamp header, but if one is provided (`svix-timestamp`
// is the common convention when Resend's underlying delivery is Svix) we
// enforce a tolerance window.
const REPLAY_TOLERANCE_SECONDS = 5 * 60;

function constantTimeEquals(a: string, b: string) {
  // Compare as hex strings of equal byte length; mismatched lengths must NOT
  // throw (which Node's timingSafeEqual would do otherwise).
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function verifySignature(rawBody: string, signature: string | null, timestamp: string | null) {
  if (process.env.NODE_ENV === "production" && !env.RESEND_WEBHOOK_SECRET) {
    // Fail closed: never accept unsigned webhooks in production.
    return false;
  }
  if (!signature || !env.RESEND_WEBHOOK_SECRET) {
    return false;
  }

  // Optional timestamp check (when the provider includes one).
  if (timestamp) {
    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - ts) > REPLAY_TOLERANCE_SECONDS) {
      return false;
    }
  }

  const signedPayload = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expectedHex = crypto.createHmac("sha256", env.RESEND_WEBHOOK_SECRET).update(signedPayload).digest("hex");

  // Strip any "sha256=" prefix and lowercase for comparison.
  const normalized = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  return constantTimeEquals(expectedHex, normalized);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-resend-signature") ?? request.headers.get("svix-signature");
  const timestamp = request.headers.get("svix-timestamp");
  if (!verifySignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: {
    type: "email.sent" | "email.delivered" | "email.bounced" | "email.complained" | "email.opened" | "email.clicked";
    data: { email_id: string };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed webhook body." }, { status: 400 });
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
  if (!eventType || !payload.data?.email_id) {
    return NextResponse.json({ error: "Unsupported webhook payload." }, { status: 400 });
  }

  // `processProviderEvent` upserts on (provider, providerMessageId, eventType)
  // so duplicate webhooks are deduped at the DB level (replay protection).
  await processProviderEvent({
    provider: "resend",
    providerMessageId: payload.data.email_id,
    eventType,
    payload: payload as unknown as Record<string, unknown>
  });

  return NextResponse.json({ success: true });
}
