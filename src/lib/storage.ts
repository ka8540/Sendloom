import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import { env } from "@/lib/env";

export type StorageMode = "local" | "r2";

export type UploadObjectArgs = {
  key: string;
  body: Buffer | Uint8Array | ReadableStream;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type UploadObjectResult = {
  key: string;
  url?: string;
};

export function getStorageMode(): StorageMode {
  return env.OBJECT_STORAGE_MODE;
}

export function getUploadRoot() {
  if (process.env.VERCEL) {
    return path.resolve("/tmp", env.LOCAL_UPLOAD_DIR);
  }

  return path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);
}

export function sanitizeFilename(fileName: string) {
  const base = path.basename(String(fileName ?? "").replace(/\\/g, "/"));
  const lastDot = base.lastIndexOf(".");
  const rawName = lastDot > 0 ? base.slice(0, lastDot) : base;
  const rawExt = lastDot > 0 ? base.slice(lastDot + 1) : "";

  const name =
    rawName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "file";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 16);

  return ext ? `${name}.${ext}` : name;
}

export function buildImportKey(userId: string, importId: string, fileName: string) {
  return `users/${userId}/imports/${importId}/${sanitizeFilename(fileName)}`;
}

export function buildAttachmentKey(userId: string, fileName: string) {
  const randomId = randomBytes(8).toString("hex");
  return `users/${userId}/campaigns/attachments/${Date.now()}-${randomId}-${sanitizeFilename(fileName)}`;
}

async function toBuffer(body: Buffer | Uint8Array | ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  const arrayBuffer = await new Response(body as ReadableStream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

let cachedR2Client: S3Client | null = null;

function getR2Config() {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID;
  const bucket = env.CLOUDFLARE_R2_BUCKET;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloudflare R2 storage is not configured. Set CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ACCESS_KEY_ID, and CLOUDFLARE_R2_SECRET_ACCESS_KEY."
    );
  }

  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function getR2Client() {
  if (!cachedR2Client) {
    const { accountId, accessKeyId, secretAccessKey } = getR2Config();
    cachedR2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  return cachedR2Client;
}

function resolveLocalPath(key: string) {
  if (path.isAbsolute(key)) {
    return key;
  }

  const root = getUploadRoot();
  const resolved = path.resolve(root, key);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key.");
  }

  return resolved;
}

export function getObjectUrl(key: string): string | null {
  if (env.OBJECT_STORAGE_MODE !== "r2") {
    return null;
  }

  const base = env.CLOUDFLARE_R2_PUBLIC_BASE_URL;
  if (!base) {
    return null;
  }

  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/+$/, "")}/${encodedKey}`;
}

export async function uploadObject(args: UploadObjectArgs): Promise<UploadObjectResult> {
  const buffer = await toBuffer(args.body);

  if (env.OBJECT_STORAGE_MODE === "r2") {
    const { bucket } = getR2Config();
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: args.key,
        Body: buffer,
        ContentType: args.contentType,
        Metadata: args.metadata
      })
    );

    return { key: args.key, url: getObjectUrl(args.key) ?? undefined };
  }

  const fullPath = resolveLocalPath(args.key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return { key: args.key };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (env.OBJECT_STORAGE_MODE === "r2" && !path.isAbsolute(key)) {
    const { bucket } = getR2Config();
    const response = await getR2Client().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    if (!response.Body) {
      throw new Error(`Storage object ${key} could not be read.`);
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  return readFile(resolveLocalPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  if (env.OBJECT_STORAGE_MODE === "r2" && !path.isAbsolute(key)) {
    const { bucket } = getR2Config();
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
    return;
  }

  await unlink(resolveLocalPath(key)).catch(() => {});
}

export async function checkStorageHealth() {
  if (env.OBJECT_STORAGE_MODE === "r2") {
    try {
      getR2Config();
      return {
        status: "ok" as const,
        message: "Cloudflare R2 storage configured."
      };
    } catch {
      return {
        status: "down" as const,
        message: "Cloudflare R2 storage is not configured."
      };
    }
  }

  try {
    const root = getUploadRoot();
    await mkdir(root, { recursive: true });
    await access(root, fsConstants.R_OK | fsConstants.W_OK);

    return {
      status: "ok" as const,
      message: "Storage reachable."
    };
  } catch {
    return {
      status: "down" as const,
      message: "Storage unavailable."
    };
  }
}
