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

  await prisma.recipientJob
    .update({
      where: { id: payload.jobId },
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
