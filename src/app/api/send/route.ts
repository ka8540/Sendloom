import { NextResponse } from "next/server";
import { z } from "zod";

import { renderEmailTemplate } from "@/components/email-template";
import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/provider";
import { getDefaultUserSender } from "@/services/senders";

const schema = z
  .object({
    firstName: z.string().min(1).default("John"),
    to: z.string().email().optional()
  })
  .optional();

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  try {
    const body = request.headers.get("content-length") === "0" ? undefined : await request.json().catch(() => undefined);
    const payload = schema.parse(body);
    const sender = await getDefaultUserSender(user.id);

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
      to: payload?.to ?? user.email,
      subject: "Sendloom delivery test",
      html,
      sender: {
        fromEmail: sender.fromEmail,
        oauthRefreshToken: sender.oauthRefreshToken
      }
    });

    return NextResponse.json(result.data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown send error"
      },
      { status: 500 }
    );
  }
}
