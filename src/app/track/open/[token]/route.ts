import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { InvalidTrackingTokenError, transparentPixel, verifyTrackingToken } from "@/lib/tracking";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  let payload;
  try {
    payload = verifyTrackingToken(token, "open");
  } catch (error) {
    if (error instanceof InvalidTrackingTokenError) {
      // Return a transparent pixel even on invalid tokens to avoid leaking
      // info to recipients/scanners; do not touch DB state.
      return new NextResponse(transparentPixel(), {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store"
        }
      });
    }
    throw error;
  }

  // Only a delivered message can be opened. Terminal recipient outcomes
  // (SUPPRESSED/FAILED/INVALID/BOUNCED/…) must never be resurrected by a pixel
  // fetch — Gmail's image proxy loads the pixel again when the SENDER views a
  // bounce report that quotes the original message, which would otherwise flip
  // a confirmed invalid address back to "Opened".
  await prisma.recipientJob
    .updateMany({
      where: { id: payload.jobId, status: "SENT" },
      data: { status: "OPENED" }
    })
    .catch(() => undefined);

  return new NextResponse(transparentPixel(), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store"
    }
  });
}
