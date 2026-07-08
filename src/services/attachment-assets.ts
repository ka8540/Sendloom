import { createHash } from "node:crypto";

import { Prisma, type AttachmentAsset } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { EmailAttachment } from "@/lib/provider";
import { buildAttachmentAssetKey, uploadObject } from "@/lib/storage";

export type FindOrCreateAttachmentAssetArgs = {
  userId: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string | null;
};

export type FindOrCreateAttachmentAssetResult = {
  asset: AttachmentAsset;
  reused: boolean;
};

// Dedupe key uses the normalized type so browser quirks ("APPLICATION/PDF",
// "text/plain; charset=utf-8") don't split identical files into separate rows.
export function normalizeContentType(raw: string | null | undefined) {
  const withoutParameters = String(raw ?? "").split(";")[0];
  return withoutParameters.trim().toLowerCase();
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Return the user's existing asset for this exact file content, or upload it
 * once and record it. Dedupe is scoped per user (never cross-user) and keyed
 * on the server-computed SHA-256 + size + normalized mime — never on filename.
 *
 * The database is the source of truth; we skip a per-attach storage existence
 * check because launch validation already reads every attachment from storage
 * and surfaces unreadable objects before sending.
 */
export async function findOrCreateAttachmentAsset(
  args: FindOrCreateAttachmentAssetArgs
): Promise<FindOrCreateAttachmentAssetResult> {
  const sha256 = createHash("sha256").update(args.buffer).digest("hex");
  const sizeBytes = args.buffer.byteLength;
  const contentType = normalizeContentType(args.contentType);
  const uniqueWhere = {
    userId_sha256_sizeBytes_contentType: {
      userId: args.userId,
      sha256,
      sizeBytes,
      contentType
    }
  };

  const existing = await prisma.attachmentAsset.findUnique({ where: uniqueWhere });
  if (existing) {
    console.info("[attachments] attachment_asset_reused", {
      assetId: existing.id,
      sizeBytes: existing.sizeBytes
    });
    return { asset: existing, reused: true };
  }

  // Upload before insert: a failed insert leaves only an idempotent orphan
  // object (healed on the next attach), while insert-first could leave a row
  // pointing at a missing object and break sends. Concurrent duplicates write
  // identical bytes to the identical content-addressed key, so races are safe.
  const upload = await uploadObject({
    bucket: "attachments",
    key: buildAttachmentAssetKey(args.userId, sha256),
    body: args.buffer,
    contentType: contentType || undefined
  });

  try {
    const asset = await prisma.attachmentAsset.create({
      data: {
        userId: args.userId,
        sha256,
        fileName: args.fileName,
        contentType,
        sizeBytes,
        storageKey: upload.key
      }
    });

    console.info("[attachments] attachment_asset_uploaded", {
      assetId: asset.id,
      sizeBytes: asset.sizeBytes
    });
    return { asset, reused: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const winner = await prisma.attachmentAsset.findUnique({ where: uniqueWhere });
    if (!winner) {
      throw error;
    }

    console.info("[attachments] attachment_asset_reused", {
      assetId: winner.id,
      sizeBytes: winner.sizeBytes
    });
    return { asset: winner, reused: true };
  }
}

// Snapshot keeps the per-upload display name and raw content type so reusing
// an asset never changes what the user sees or what Gmail receives.
export function toAttachmentSnapshot(
  asset: AttachmentAsset,
  uploadedFileName: string,
  uploadedContentType?: string | null
): EmailAttachment {
  return {
    fileName: uploadedFileName,
    storagePath: asset.storageKey,
    contentType: uploadedContentType || null,
    assetId: asset.id,
    sizeBytes: asset.sizeBytes
  };
}
