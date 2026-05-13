import { NextResponse } from "next/server";

import { requireAdminApiUser } from "@/lib/api-auth";
import { getPaginationParams } from "@/lib/pagination";
import { listAdminUsersPage } from "@/services/admin";

export async function GET(request: Request) {
  const auth = await requireAdminApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const pagination = getPaginationParams(new URL(request.url).searchParams, {
    defaultPageSize: 20,
    maxPageSize: 100
  });

  return NextResponse.json(await listAdminUsersPage(pagination));
}
