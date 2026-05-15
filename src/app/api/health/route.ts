import { NextResponse } from "next/server";

import { getSystemHealth } from "@/lib/system-health";

export async function GET() {
  return NextResponse.json(await getSystemHealth());
}
