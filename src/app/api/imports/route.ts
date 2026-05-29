import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { createImport } from "@/services/imports";

const MAX_IMPORT_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_IMPORT_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);

function hasAllowedExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_IMPORT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export async function POST(request: Request) {
  const auth = await requireApiUser("importsWrite");
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `imports:create:user:${auth.user.id}`, limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload file is required." }, { status: 400 });
  }

  if (!hasAllowedExtension(file.name)) {
    return NextResponse.json({ error: "Upload a CSV, XLS, or XLSX file." }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "Import files must be 25 MB or smaller." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const importRecord = await createImport(file.name, file.type, buffer, auth.user.id);

  return NextResponse.json(importRecord);
}
