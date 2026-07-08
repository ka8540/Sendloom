import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory AttachmentAsset table + upload spy. No database or storage is
// ever touched; everything lives in vi.hoisted so the mock factories below
// can reference it.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type AssetRow = {
    id: string;
    userId: string;
    sha256: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    createdAt: Date;
    updatedAt: Date;
  };

  class PrismaKnownError extends Error {
    code = "P2002";
  }

  const state = {
    assets: [] as AssetRow[],
    nextId: 1,
    // When set, the next create throws P2002 after inserting this row, as if
    // a concurrent request won the race.
    raceWinner: null as AssetRow | null
  };

  const uploads: { bucket: string; key: string; body: Buffer; contentType?: string }[] = [];

  function matchesUnique(row: AssetRow, where: Record<string, unknown>) {
    return (
      row.userId === where.userId &&
      row.sha256 === where.sha256 &&
      row.sizeBytes === where.sizeBytes &&
      row.contentType === where.contentType
    );
  }

  const prismaMock = {
    attachmentAsset: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const tuple = where.userId_sha256_sizeBytes_contentType;
        return state.assets.find((row) => matchesUnique(row, tuple)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        if (state.raceWinner) {
          state.assets.push(state.raceWinner);
          state.raceWinner = null;
          throw new PrismaKnownError("Unique constraint failed");
        }

        if (state.assets.some((row) => matchesUnique(row, data))) {
          throw new PrismaKnownError("Unique constraint failed");
        }

        const row: AssetRow = {
          id: `asset-${state.nextId++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as Omit<AssetRow, "id" | "createdAt" | "updatedAt">)
        };
        state.assets.push(row);
        return { ...row };
      })
    }
  };

  return { state, uploads, prismaMock, PrismaKnownError };
});

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: h.PrismaKnownError }
}));

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));

vi.mock("@/lib/storage", () => ({
  buildAttachmentAssetKey: (userId: string, sha256: string) => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error("Invalid attachment hash.");
    }
    return `users/${userId}/attachments/${sha256}`;
  },
  uploadObject: vi.fn(async (args: { bucket: string; key: string; body: Buffer; contentType?: string }) => {
    h.uploads.push(args);
    return { key: args.key };
  })
}));

import {
  findOrCreateAttachmentAsset,
  normalizeContentType,
  toAttachmentSnapshot
} from "@/services/attachment-assets";

const PDF_BYTES = Buffer.from("%PDF-1.7 fake resume body");
const OTHER_PDF_BYTES = Buffer.from("%PDF-1.7 a different document");

function sha256Of(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

beforeEach(() => {
  h.state.assets.length = 0;
  h.state.nextId = 1;
  h.state.raceWinner = null;
  h.uploads.length = 0;
  vi.clearAllMocks();
});

describe("normalizeContentType", () => {
  it("lowercases, trims, and strips parameter suffixes", () => {
    expect(normalizeContentType("APPLICATION/PDF")).toBe("application/pdf");
    expect(normalizeContentType("  text/plain; charset=utf-8 ")).toBe("text/plain");
  });

  it("returns an empty string when the type is missing", () => {
    expect(normalizeContentType(null)).toBe("");
    expect(normalizeContentType(undefined)).toBe("");
    expect(normalizeContentType("   ")).toBe("");
  });
});

describe("findOrCreateAttachmentAsset", () => {
  it("uploads a new file once and records a content-addressed asset", async () => {
    const { asset, reused } = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });

    expect(reused).toBe(false);
    expect(h.uploads).toHaveLength(1);
    expect(asset.storageKey).toBe(`users/user-1/attachments/${sha256Of(PDF_BYTES)}`);
    expect(asset.sha256).toBe(sha256Of(PDF_BYTES));
    expect(asset.sizeBytes).toBe(PDF_BYTES.byteLength);
    expect(h.state.assets).toHaveLength(1);
  });

  it("reuses the existing asset for identical content without uploading again", async () => {
    const first = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });

    expect(second.reused).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.storageKey).toBe(first.asset.storageKey);
    expect(h.uploads).toHaveLength(1);
    expect(h.state.assets).toHaveLength(1);
  });

  it("treats the same filename with different content as a new asset", async () => {
    await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: OTHER_PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });

    expect(second.reused).toBe(false);
    expect(h.uploads).toHaveLength(2);
    expect(h.state.assets).toHaveLength(2);
    expect(second.asset.storageKey).toBe(`users/user-1/attachments/${sha256Of(OTHER_PDF_BYTES)}`);
  });

  it("reuses the asset when the same content arrives under a new filename", async () => {
    const first = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "cv-final.pdf",
      contentType: "application/pdf"
    });

    expect(second.reused).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(h.uploads).toHaveLength(1);

    // The snapshot keeps the per-upload display name even for reused assets.
    const snapshot = toAttachmentSnapshot(second.asset, "cv-final.pdf", "application/pdf");
    expect(snapshot.fileName).toBe("cv-final.pdf");
    expect(snapshot.storagePath).toBe(first.asset.storageKey);
  });

  it("never reuses another user's asset for the same content", async () => {
    const first = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-2",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });

    expect(second.reused).toBe(false);
    expect(second.asset.id).not.toBe(first.asset.id);
    expect(second.asset.storageKey).toBe(`users/user-2/attachments/${sha256Of(PDF_BYTES)}`);
    expect(h.uploads).toHaveLength(2);
  });

  it("keeps separate rows per content type while sharing the storage key", async () => {
    const first = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: null
    });

    expect(second.reused).toBe(false);
    expect(second.asset.id).not.toBe(first.asset.id);
    expect(second.asset.storageKey).toBe(first.asset.storageKey);
  });

  it("dedupes content types that differ only by casing or parameters", async () => {
    await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });
    const second = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "APPLICATION/PDF; name=resume.pdf"
    });

    expect(second.reused).toBe(true);
    expect(h.uploads).toHaveLength(1);
  });

  it("returns the winning row when a concurrent request creates the same asset", async () => {
    const sha256 = sha256Of(PDF_BYTES);
    h.state.raceWinner = {
      id: "asset-winner",
      userId: "user-1",
      sha256,
      fileName: "resume.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
      storageKey: `users/user-1/attachments/${sha256}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await findOrCreateAttachmentAsset({
      userId: "user-1",
      buffer: PDF_BYTES,
      fileName: "resume.pdf",
      contentType: "application/pdf"
    });

    expect(result.reused).toBe(true);
    expect(result.asset.id).toBe("asset-winner");
    // The racing upload wrote identical bytes to the identical key, so a
    // duplicate PUT is harmless and no cleanup is required.
    expect(h.uploads).toHaveLength(1);
    expect(h.state.assets).toHaveLength(1);
  });
});

describe("toAttachmentSnapshot", () => {
  it("references the shared storage key and keeps the raw content type", () => {
    const asset = {
      id: "asset-1",
      userId: "user-1",
      sha256: "a".repeat(64),
      fileName: "resume.pdf",
      contentType: "application/pdf",
      sizeBytes: 42,
      storageKey: `users/user-1/attachments/${"a".repeat(64)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(toAttachmentSnapshot(asset, "My Résumé.pdf", "application/pdf")).toEqual({
      fileName: "My Résumé.pdf",
      storagePath: asset.storageKey,
      contentType: "application/pdf",
      assetId: "asset-1",
      sizeBytes: 42
    });

    expect(toAttachmentSnapshot(asset, "resume.pdf", "").contentType).toBeNull();
  });
});
