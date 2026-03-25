import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { verifyTrackingToken } from "@/lib/tracking";
import { suppressEmail } from "@/services/suppressions";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = verifyTrackingToken(token);

  const recipientJob = await prisma.recipientJob.findUnique({
    where: { id: payload.jobId },
    include: {
      campaignRun: {
        include: {
          campaign: {
            select: {
              userId: true
            }
          }
        }
      }
    }
  });

  if (recipientJob?.campaignRun.campaign.userId) {
    await suppressEmail(recipientJob.campaignRun.campaign.userId, payload.email, "UNSUBSCRIBED", "unsubscribe-link");
  }

  return new NextResponse("You have been unsubscribed.", { status: 200 });
}
