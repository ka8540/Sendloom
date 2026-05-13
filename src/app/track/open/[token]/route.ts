import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { safeVerifyTrackingToken, transparentPixel } from "@/lib/tracking";

function pixelResponse() {
  return new NextResponse(transparentPixel(), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store"
    }
  });
}

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = safeVerifyTrackingToken(token);

  if (payload?.type !== "open") {
    return pixelResponse();
  }

  await prisma.recipientJob.update({
    where: {
      id: payload.jobId
    },
    data: {
      status: "OPENED"
    }
  }).catch(() => undefined);

  return pixelResponse();
}
