import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { HunterApiError, searchHunterDomain } from "@/lib/hunter";
import { getDecryptedHunterKeyForUser } from "@/services/hunter-keys";

const schema = z.object({
  domain: z.string().trim().min(1, "Enter a company domain.")
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a company domain." }, { status: 400 });
  }

  const payload = parsed.data;
  const apiKey = await getDecryptedHunterKeyForUser(auth.user.id);

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Save your Hunter API key in Settings before searching."
      },
      { status: 400 }
    );
  }

  try {
    const results = await searchHunterDomain(apiKey, payload.domain);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Domain search failed.";
    const status = error instanceof HunterApiError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
