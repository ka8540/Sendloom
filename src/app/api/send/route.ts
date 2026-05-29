import { NextResponse } from "next/server";
import { z } from "zod";

import { renderEmailTemplate } from "@/components/email-template";
import { requireApiUser } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { GMAIL_RECONNECT_ERROR, getUserSafeGmailSendError, isGmailReconnectError, sendEmail } from "@/lib/provider";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { getDefaultUserSender, markSenderRequiresReconnect } from "@/services/senders";

const schema = z
  .object({
    firstName: z.string().min(1).default("John")
  })
  .optional();

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `send:test:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  try {
    const body = request.headers.get("content-length") === "0" ? undefined : await request.json().catch(() => undefined);
    const payload = schema.parse(body);
    const sender = await getDefaultUserSender(auth.user.id);

    if (!sender) {
      return NextResponse.json(
        {
          error: "No Gmail account connected. Connect Gmail before sending a test email."
        },
        { status: 400 }
      );
    }

    const html = renderEmailTemplate({ firstName: payload?.firstName ?? "John" });
    const result = await sendEmail({
      from: `${sender.name || env.DEFAULT_FROM_NAME || sender.fromEmail} <${sender.fromEmail}>`,
      // Test sends are deliberately locked to the authenticated user's own
      // email to prevent /api/send from being used as a generic Gmail relay.
      to: auth.user.email,
      subject: "Sendloom delivery test",
      html,
      sender: {
        fromEmail: sender.fromEmail,
        oauthRefreshToken: sender.oauthRefreshToken
      }
    });

    return NextResponse.json(result.data);
  } catch (error) {
    if (error instanceof Error && isGmailReconnectError(error)) {
      const sender = await getDefaultUserSender(auth.user.id);
      if (sender) {
        await markSenderRequiresReconnect(sender.id);
      }

      return NextResponse.json(
        {
          error: GMAIL_RECONNECT_ERROR
        },
        { status: 400 }
      );
    }

    console.error("[send-email] Test email send failed.", error);
    return NextResponse.json(
      {
        error: getUserSafeGmailSendError(error)
      },
      { status: 500 }
    );
  }
}
