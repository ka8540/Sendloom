import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

function getUploadRoot() {
  if (process.env.VERCEL) {
    return path.resolve("/tmp", env.LOCAL_UPLOAD_DIR);
  }

  return path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);
}

export async function storeUpload(fileName: string, contents: Buffer, subdirectory?: string) {
  const dir = subdirectory
    ? path.resolve(getUploadRoot(), subdirectory)
    : getUploadRoot();
  await mkdir(dir, { recursive: true });

  const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const fullPath = path.join(dir, safeName);
  await writeFile(fullPath, contents);

  return fullPath;
}
