import { NextResponse } from "next/server";

// Public health endpoint. Returns ONLY a binary status. Detailed system health
// (DB/Redis/storage/secret config) is intentionally kept behind the admin-only
// `/api/admin/system-health` endpoint to avoid leaking config to attackers.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
