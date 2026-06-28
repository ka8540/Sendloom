import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { errorContextSchema } from "@/lib/incident/report-input";
import { captureErrorEvent } from "@/services/incident-reports";

// Auto-capture a sanitized technical event when an eligible failure occurs. This
// is a SEPARATE control from report submission (different rate limit) so the
// automatic technical logging and the user's explicit report stay independent.
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = errorContextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid error context." }, { status: 400 });
  }

  const result = await captureErrorEvent(parsed.data, { id: auth.user.id, email: auth.user.email });
  if (!result.ok) {
    // Capture is best-effort; a throttled auto-capture is not a user-facing error.
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  return NextResponse.json({ eventId: result.eventId });
}
