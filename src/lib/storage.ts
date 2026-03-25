import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

export async function storeUpload(fileName: string, contents: Buffer, subdirectory?: string) {
  const dir = subdirectory
    ? path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR, subdirectory)
    : path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);
  await mkdir(dir, { recursive: true });

  const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const fullPath = path.join(dir, safeName);
  await writeFile(fullPath, contents);

  return fullPath;
}
