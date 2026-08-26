import { NextResponse } from "next/server";
import { z } from "zod";

import { SystemNoticeActionError, SystemNoticeValidationError } from "@/lib/system-notices";

export async function readJsonBody(request: Request) {
  try {
    return { ok: true as const, body: (await request.json()) as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    };
  }
}

export function systemNoticeErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || "Invalid system notice." },
      { status: 400 }
    );
  }
  if (error instanceof SystemNoticeValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof SystemNoticeActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[system-notice-api] Request failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return NextResponse.json({ error: "The system notice request failed." }, { status: 500 });
}
