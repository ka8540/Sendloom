import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  return NextResponse.json({
    verified: Boolean(
      user.adultVerifiedAt &&
      user.termsAcceptedAt &&
      user.privacyAcceptedAt &&
      user.antiAbuseAcceptedAt
    ),
    blocked: Boolean(user.eligibilityBlockedAt),
    restricted: Boolean(user.restrictedAt),
    policyVersion: user.policyVersion ?? null
  });
}
