import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

const POLICY_VERSION = "1.0";
const AGE_GATE_VERSION = "1.0";

const schema = z.object({
  confirmAdult: z.literal(true),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
  acceptAntiAbuse: z.literal(true)
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  if (user.eligibilityBlockedAt) {
    return NextResponse.json(
      { error: "This account has been blocked due to ineligibility." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "All confirmations must be accepted." },
      { status: 400 }
    );
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      adultVerifiedAt: now,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      antiAbuseAcceptedAt: now,
      policyVersion: POLICY_VERSION,
      ageGateVersion: AGE_GATE_VERSION
    }
  });

  await recordAuditEvent({
    actor: { id: user.id, email: user.email },
    action: "compliance.policy_accepted",
    category: "USER",
    severity: "SUCCESS",
    message: `User accepted adult verification, terms, privacy, and anti-abuse policies (v${POLICY_VERSION}).`,
    metadata: { policyVersion: POLICY_VERSION, ageGateVersion: AGE_GATE_VERSION },
    request
  });

  return NextResponse.json({ success: true });
}
