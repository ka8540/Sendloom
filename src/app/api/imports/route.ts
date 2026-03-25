import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createImport } from "@/services/imports";

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload file is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const importRecord = await createImport(file.name, file.type, buffer, user.id);

  return NextResponse.json(importRecord);
}
