import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getGmailDailySendWindow, getDailySendLimit } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";

type SenderWindow = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: Awaited<ReturnType<typeof getGmailDailySendWindow>>;
};

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const senders = await prisma.senderProfile.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromEmail: true,
      name: true,
      oauthRefreshToken: true
    }
  });

  const senderWindows: SenderWindow[] = await Promise.all(
    senders.map(async (sender) => ({
      senderProfileId: sender.id,
      senderEmail: sender.fromEmail,
      senderName: sender.name,
      connected: Boolean(sender.oauthRefreshToken),
      window: await getGmailDailySendWindow({
        userId: auth.user.id,
        senderProfileId: sender.id
      })
    }))
  );

  const userWindow = await getGmailDailySendWindow({ userId: auth.user.id });

  return NextResponse.json({
    limit: getDailySendLimit(),
    user: userWindow,
    senders: senderWindows
  });
}
