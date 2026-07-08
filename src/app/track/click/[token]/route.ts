import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { InvalidTrackingTokenError, verifyTrackingToken } from "@/lib/tracking";

function notFound() {
  return new NextResponse(null, { status: 404 });
}

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  let payload;
  try {
    payload = verifyTrackingToken(token, "click");
  } catch (error) {
    if (error instanceof InvalidTrackingTokenError) {
      return notFound();
    }
    throw error;
  }

  // Only allow same-origin redirects. An absolute attacker-controlled URL
  // would otherwise override `env.APP_BASE_URL` (WHATWG URL constructor
  // semantics) and create an open redirect inside the email.
  const base = new URL(env.APP_BASE_URL);
  let destination: URL;
  try {
    destination = new URL(payload.target ?? "/", base);
  } catch {
    return notFound();
  }
  if (destination.origin !== base.origin) {
    return notFound();
  }

  // Clicks only advance delivered/opened messages. Terminal outcomes
  // (SUPPRESSED/FAILED/INVALID/BOUNCED/…) stay untouched so a link fetched
  // from a quoted bounce report or by a scanner can never resurrect a
  // confirmed invalid address into an engagement state.
  await prisma.recipientJob
    .updateMany({
      where: { id: payload.jobId, status: { in: ["SENT", "OPENED"] } },
      data: { status: "CLICKED" }
    })
    .catch(() => undefined);

  return NextResponse.redirect(destination);
}
