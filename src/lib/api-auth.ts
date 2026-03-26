import { NextResponse } from "next/server";

import { SESSION_ERROR_MESSAGE } from "@/lib/auth";

export function createUnauthorizedApiResponse(message = SESSION_ERROR_MESSAGE) {
  return NextResponse.json(
    {
      error: message
    },
    { status: 401 }
  );
}
