import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { readJsonBody, systemNoticeErrorResponse } from "@/lib/system-notice-api";
import { renderSystemNoticeEmail } from "@/lib/system-notice-email";
import { systemNoticeInputSchema } from "@/lib/system-notices";

export async function POST(request: Request) {
  const auth = await requireAdminApiUser(request);
  if ("response" in auth) return auth.response;

  const limit = await rateLimit({ key: `admin:system-notices:preview:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  try {
    const notice = systemNoticeInputSchema.parse(body.body);
    const rendered = renderSystemNoticeEmail({ notice, appBaseUrl: env.APP_BASE_URL });
    return NextResponse.json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      typeLabel: rendered.typeLabel,
      impactWindow: rendered.impactWindow
    });
  } catch (error) {
    return systemNoticeErrorResponse(error);
  }
}
