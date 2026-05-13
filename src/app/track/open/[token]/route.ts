import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { transparentPixel, verifyTrackingToken } from "@/lib/tracking";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = verifyTrackingToken(token);
  await prisma.recipientJob.update({
    where: {
      id: payload.jobId
    },
    data: {
      status: "OPENED"
    }
  });

  return new NextResponse(transparentPixel(), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store"
    }
  });
}
