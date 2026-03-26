import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { createImport } from "@/services/imports";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload file is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const importRecord = await createImport(file.name, file.type, buffer, user.id);

  return NextResponse.json(importRecord);
}
