import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { createReportSchema } from "@/lib/incident/report-input";
import { newRequestId } from "@/lib/request-id";
import { createIncidentReport } from "@/services/incident-reports";

// Authenticated only — incident creation is never exposed without a session.
// CSRF is enforced globally by middleware for unsafe-method /api routes.
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body.", requestId: newRequestId() }, { status: 400 });
  }

  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "We couldn't send this report. Please try again.", requestId: newRequestId() }, { status: 400 });
  }

  const result = await createIncidentReport(parsed.data, { id: auth.user.id, email: auth.user.email });

  if (!result.ok) {
    // Rate limited: the failure is already captured — surface the safe message,
    // never an internal counter or key.
    return NextResponse.json(
      { rateLimited: true, message: "This issue has already been recorded. You do not need to submit it again." },
      { status: 429 }
    );
  }

  return NextResponse.json({
    reportId: result.reportId,
    status: result.status,
    deduplicated: result.deduplicated
  });
}
