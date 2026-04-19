import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getHunterDomainSearchForUser } from "@/services/hunter-domain-searches";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const savedSearch = await getHunterDomainSearchForUser(auth.user.id, id);

  if (!savedSearch) {
    return NextResponse.json({ error: "Saved domain search not found." }, { status: 404 });
  }

  return NextResponse.json(savedSearch);
}
