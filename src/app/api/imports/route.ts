import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { createImport } from "@/services/imports";

export async function POST(request: Request) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload file is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const importRecord = await createImport(file.name, file.type, buffer, auth.user.id);

  return NextResponse.json(importRecord);
}
