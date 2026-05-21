import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, unknown> }));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

import {
  buildAttachmentKey,
  buildImportKey,
  checkStorageHealth,
  deleteObject,
  getObjectBuffer,
  getObjectUrl,
  getStorageMode,
  sanitizeFilename,
  uploadObject
} from "@/lib/storage";

const localRoot = await mkdtemp(path.join(tmpdir(), "sendloom-storage-"));

function useLocalMode() {
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key];
  }
  mockEnv.OBJECT_STORAGE_MODE = "local";
  mockEnv.LOCAL_UPLOAD_DIR = localRoot;
}

function useR2ModeWithoutCredentials() {
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key];
  }
  mockEnv.OBJECT_STORAGE_MODE = "r2";
  mockEnv.LOCAL_UPLOAD_DIR = localRoot;
}

beforeEach(() => {
  useLocalMode();
});

afterAll(async () => {
  await rm(localRoot, { recursive: true, force: true });
});

describe("sanitizeFilename", () => {
  it("strips path traversal segments and keeps a safe extension", () => {
    expect(sanitizeFilename("../../../etc/passwd.csv")).toBe("passwd.csv");
    expect(sanitizeFilename("..\\..\\windows\\system32.xlsx")).toBe("system32.xlsx");
  });

  it("replaces unsafe characters but preserves the extension", () => {
    const safe = sanitizeFilename("my résumé (final).pdf");
    expect(safe).toMatch(/^[a-zA-Z0-9._-]+\.pdf$/);
    expect(safe).not.toMatch(/[ ()]/);
  });

  it("falls back to a default name when nothing usable remains", () => {
    expect(sanitizeFilename("///")).toBe("file");
  });
});

describe("storage keys", () => {
  it("scopes import keys under the user and import id", () => {
    expect(buildImportKey("user-1", "import-9", "../leads.csv")).toBe(
      "users/user-1/imports/import-9/leads.csv"
    );
  });

  it("produces a unique, sanitized attachment key", () => {
    const key = buildAttachmentKey("user-1", "../../resume.pdf");
    expect(key).toMatch(/^users\/user-1\/campaigns\/attachments\/\d+-[a-f0-9]+-resume\.pdf$/);
  });
});

describe("local storage mode", () => {
  it("reports local mode from the environment", () => {
    expect(getStorageMode()).toBe("local");
  });

  it("never exposes a public URL in local mode", () => {
    expect(getObjectUrl("users/user-1/imports/import-9/leads.csv")).toBeNull();
  });

  it("uploads, reads, and deletes an object on the local filesystem", async () => {
    const key = buildImportKey("user-1", "import-9", "leads.csv");
    const result = await uploadObject({ bucket: "imports", key, body: Buffer.from("a,b\n1,2\n") });

    expect(result.key).toBe(key);
    expect(result.url).toBeUndefined();

    const buffer = await getObjectBuffer("imports", key);
    expect(buffer.toString()).toBe("a,b\n1,2\n");

    await deleteObject("imports", key);
    await expect(getObjectBuffer("imports", key)).rejects.toThrow();
  });

  it("rejects keys that escape the upload root", async () => {
    await expect(getObjectBuffer("imports", "../../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("r2 storage mode", () => {
  it("fails clearly when R2 credentials are missing", async () => {
    useR2ModeWithoutCredentials();

    await expect(
      uploadObject({
        bucket: "attachments",
        key: "users/user-1/campaigns/attachments/resume.pdf",
        body: Buffer.from("x")
      })
    ).rejects.toThrow(/Cloudflare R2 storage is not configured/);
  });

  it("fails clearly when a bucket name is missing", async () => {
    useR2ModeWithoutCredentials();
    mockEnv.CLOUDFLARE_R2_ACCOUNT_ID = "account-id";
    mockEnv.CLOUDFLARE_R2_ACCESS_KEY_ID = "access-key-id";
    mockEnv.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret-access-key";
    mockEnv.CLOUDFLARE_R2_IMPORTS_BUCKET = "sendloom-imports";

    await expect(
      uploadObject({
        bucket: "attachments",
        key: "users/user-1/campaigns/attachments/resume.pdf",
        body: Buffer.from("x")
      })
    ).rejects.toThrow(/CLOUDFLARE_R2_ATTACHMENTS_BUCKET/);
  });

  it("reports unhealthy storage when R2 credentials are missing", async () => {
    useR2ModeWithoutCredentials();

    await expect(checkStorageHealth()).resolves.toMatchObject({ status: "down" });
  });
});
