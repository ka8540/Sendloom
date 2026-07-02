import { NextResponse } from "next/server";
import { after } from "next/server";

import { env } from "@/lib/env";
import { getRedis } from "@/lib/redis";
import { handleGmailPushNotification } from "@/services/bounces";

// Gmail mailbox push notifications (Cloud Pub/Sub push subscription). The
// payload is UNTRUSTED: it only tells us which mailbox may have changed — the
// sender is resolved server-side and all mailbox reads happen with that
// sender's own token. Responds fast (Pub/Sub redelivers slow acks) and runs
// the actual history sync after the response is sent.

export const maxDuration = 60;

const PUSH_DEDUPE_TTL_SECONDS = 60 * 60;
const MAX_BODY_BYTES = 64_000;
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

function constantTimeEquals(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * A push request is accepted when EITHER the shared verification token in the
 * URL matches, OR the Pub/Sub OIDC bearer token validates against the
 * configured audience (and service account, when set). With neither mechanism
 * configured the endpoint fails closed — it can never be an open job trigger.
 */
async function isAuthorizedPush(request: Request): Promise<boolean> {
  const sharedToken = env.GMAIL_PUBSUB_VERIFICATION_TOKEN;
  if (sharedToken) {
    const provided = new URL(request.url).searchParams.get("token");
    if (provided && constantTimeEquals(provided, sharedToken)) {
      return true;
    }
  }

  const audience = env.GMAIL_PUBSUB_AUDIENCE;
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (audience && bearer && bearer.length < 4096) {
    try {
      const response = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(bearer)}`);
      if (!response.ok) {
        return false;
      }
      const info = (await response.json()) as {
        aud?: string;
        iss?: string;
        email?: string;
        email_verified?: string | boolean;
      };
      const issuerOk = info.iss === "https://accounts.google.com" || info.iss === "accounts.google.com";
      const audienceOk = info.aud === audience;
      const emailOk =
        !env.GMAIL_PUBSUB_SERVICE_ACCOUNT ||
        (String(info.email_verified) === "true" && info.email === env.GMAIL_PUBSUB_SERVICE_ACCOUNT);
      return issuerOk && audienceOk && emailOk;
    } catch {
      return false;
    }
  }

  return false;
}

type PubSubPushBody = {
  message?: { data?: string; messageId?: string; message_id?: string };
  subscription?: string;
};

function decodeNotification(body: PubSubPushBody): { emailAddress: string } | null {
  const data = body.message?.data;
  if (!data || typeof data !== "string") {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { emailAddress?: unknown };
    const emailAddress = typeof decoded.emailAddress === "string" ? decoded.emailAddress.trim() : "";
    if (!emailAddress || emailAddress.length > 320 || !emailAddress.includes("@")) {
      return null;
    }
    return { emailAddress };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!(await isAuthorizedPush(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    // Ack malformed-but-authenticated messages so Pub/Sub never redelivers a
    // poison payload forever. Nothing is processed.
    return new Response(null, { status: 204 });
  }

  let body: PubSubPushBody;
  try {
    body = JSON.parse(rawBody) as PubSubPushBody;
  } catch {
    return new Response(null, { status: 204 });
  }

  const notification = decodeNotification(body);
  if (!notification) {
    return new Response(null, { status: 204 });
  }

  // Deduplicate Pub/Sub redeliveries by message id before doing any work.
  const pubsubMessageId = body.message?.messageId ?? body.message?.message_id ?? null;
  if (pubsubMessageId) {
    try {
      const first = await getRedis().set(
        `sendloom:gmail-push:${pubsubMessageId}`,
        "1",
        "EX",
        PUSH_DEDUPE_TTL_SECONDS,
        "NX"
      );
      if (first !== "OK") {
        return new Response(null, { status: 204 });
      }
    } catch {
      // Redis unavailable: proceed — the per-sender sync lock and per-message
      // event key downstream still keep processing idempotent.
    }
  }

  // Acknowledge immediately; the mailbox sync runs after the response.
  after(async () => {
    try {
      await handleGmailPushNotification({ emailAddress: notification.emailAddress });
    } catch (error) {
      // Never log the mailbox address — a safe category only.
      console.warn("[gmail-pubsub] Bounce sync after push failed.", {
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown"
      });
    }
  });

  return new Response(null, { status: 204 });
}
