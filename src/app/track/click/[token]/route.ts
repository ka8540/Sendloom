import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyTrackingToken } from "@/lib/tracking";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = verifyTrackingToken(token);
  await prisma.recipientJob.update({
    where: {
      id: payload.jobId
    },
    data: {
      status: "CLICKED"
    }
  });

  const destination = payload.target
    ? new URL(payload.target, env.APP_BASE_URL)
    : new URL("/", env.APP_BASE_URL);

  return NextResponse.redirect(destination);
}
