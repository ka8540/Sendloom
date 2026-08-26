import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  updateUser: vi.fn(),
  rateLimit: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  getObjectBuffer: vi.fn()
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update: mocks.updateUser } } }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  createRateLimitResponse: () =>
    new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 })
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    uploadObject: mocks.uploadObject,
    deleteObject: mocks.deleteObject,
    getObjectBuffer: mocks.getObjectBuffer
  };
});

import { DELETE as removePhoto, POST as uploadPhoto } from "./route";
import { GET as servePhoto } from "./image/route";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const baseUser = {
  id: "user-1",
  email: "user@example.com",
  profilePhotoKey: null as string | null,
  profilePhotoContentType: null as string | null
};

function uploadRequest(file: File | null, extraFields: Record<string, string> = {}) {
  const formData = new FormData();
  if (file) {
    formData.append("photo", file);
  }
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value);
  }
  return new Request("https://sendloom.test/api/account/profile-photo", {
    method: "POST",
    body: formData
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { ...baseUser } });
  mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
  mocks.uploadObject.mockResolvedValue({ key: "ignored" });
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.updateUser.mockImplementation(async ({ data }) => ({
    profilePhotoUpdatedAt: data.profilePhotoUpdatedAt ?? null
  }));
});

describe("POST /api/account/profile-photo", () => {
  it("rejects unauthenticated uploads", async () => {
    mocks.requireUser.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "nope" }), { status: 401 })
    });

    const res = await uploadPhoto(uploadRequest(new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" })));

    expect(res.status).toBe(401);
    expect(mocks.uploadObject).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects requests without a photo file", async () => {
    const res = await uploadPhoto(uploadRequest(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Upload a JPG, PNG, or WebP image." });
  });

  it.each([
    ["JPEG", JPEG_BYTES, "image/jpeg", "jpg"],
    ["PNG", PNG_BYTES, "image/png", "png"],
    ["WebP", WEBP_BYTES, "image/webp", "webp"]
  ])("accepts a valid %s and stores it in the attachments bucket", async (_label, bytes, contentType, extension) => {
    const res = await uploadPhoto(uploadRequest(new File([bytes], "upload.bin", { type: contentType })));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profilePhotoUrl).toMatch(/^\/api\/account\/profile-photo\/image\?v=\d+$/);

    expect(mocks.uploadObject).toHaveBeenCalledTimes(1);
    const uploadArgs = mocks.uploadObject.mock.calls[0][0];
    expect(uploadArgs.bucket).toBe("attachments");
    expect(uploadArgs.key).toMatch(new RegExp(`^users/user-1/profile-photo/[a-z0-9-]+\\.${extension}$`));
    expect(uploadArgs.contentType).toBe(contentType);

    const updateArgs = mocks.updateUser.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "user-1" });
    expect(updateArgs.data.profilePhotoKey).toBe(uploadArgs.key);
    expect(updateArgs.data.profilePhotoContentType).toBe(contentType);

    // No previous photo — nothing to clean up.
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects SVG uploads even when they claim an image MIME type", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await uploadPhoto(uploadRequest(new File([svg], "avatar.svg", { type: "image/svg+xml" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Upload a JPG, PNG, or WebP image." });
    expect(mocks.uploadObject).not.toHaveBeenCalled();
  });

  it("rejects a spoofed MIME type when the bytes are not an image", async () => {
    const text = new TextEncoder().encode("this is plain text, not a png");
    const res = await uploadPhoto(uploadRequest(new File([text], "fake.png", { type: "image/png" })));

    expect(res.status).toBe(400);
    expect(mocks.uploadObject).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects files larger than 5 MB before reading them", async () => {
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    const res = await uploadPhoto(uploadRequest(huge));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Profile photos must be 5 MB or smaller." });
    expect(mocks.uploadObject).not.toHaveBeenCalled();
  });

  it("ignores any client-supplied userId and always scopes to the session user", async () => {
    const res = await uploadPhoto(
      uploadRequest(new File([PNG_BYTES], "a.png", { type: "image/png" }), { userId: "attacker-id" })
    );

    expect(res.status).toBe(200);
    expect(mocks.uploadObject.mock.calls[0][0].key).toMatch(/^users\/user-1\/profile-photo\//);
    expect(mocks.updateUser.mock.calls[0][0].where).toEqual({ id: "user-1" });
    expect(JSON.stringify(mocks.updateUser.mock.calls[0][0])).not.toContain("attacker-id");
  });

  it("uploads the new photo before deleting the old one, then removes the old object", async () => {
    mocks.requireUser.mockResolvedValue({
      user: { ...baseUser, profilePhotoKey: "users/user-1/profile-photo/old.jpg" }
    });

    const res = await uploadPhoto(uploadRequest(new File([JPEG_BYTES], "new.jpg", { type: "image/jpeg" })));
    expect(res.status).toBe(200);

    const newKey = mocks.uploadObject.mock.calls[0][0].key as string;
    expect(newKey).not.toBe("users/user-1/profile-photo/old.jpg");

    // Order: upload new → update DB → delete old.
    const uploadOrder = mocks.uploadObject.mock.invocationCallOrder[0];
    const updateOrder = mocks.updateUser.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteObject.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(deleteOrder);
    expect(mocks.deleteObject).toHaveBeenCalledWith("attachments", "users/user-1/profile-photo/old.jpg");
  });

  it("cleans up the newly uploaded object when the DB update fails", async () => {
    mocks.updateUser.mockRejectedValue(new Error("db down"));

    const res = await uploadPhoto(uploadRequest(new File([JPEG_BYTES], "new.jpg", { type: "image/jpeg" })));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "We couldn't update your profile photo. Please try again." });

    const newKey = mocks.uploadObject.mock.calls[0][0].key as string;
    expect(mocks.deleteObject).toHaveBeenCalledWith("attachments", newKey);
  });

  it("keeps the old photo when the new upload itself fails", async () => {
    mocks.requireUser.mockResolvedValue({
      user: { ...baseUser, profilePhotoKey: "users/user-1/profile-photo/old.jpg" }
    });
    mocks.uploadObject.mockRejectedValue(new Error("r2 down"));

    const res = await uploadPhoto(uploadRequest(new File([JPEG_BYTES], "new.jpg", { type: "image/jpeg" })));
    expect(res.status).toBe(500);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account/profile-photo", () => {
  it("rejects unauthenticated deletes", async () => {
    mocks.requireUser.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "nope" }), { status: 401 })
    });

    const res = await removePhoto();
    expect(res.status).toBe(401);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("clears only the authenticated user's photo and deletes the old object", async () => {
    mocks.requireUser.mockResolvedValue({
      user: { ...baseUser, profilePhotoKey: "users/user-1/profile-photo/old.webp" }
    });

    const res = await removePhoto();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profilePhotoUrl: null });

    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { profilePhotoKey: null, profilePhotoContentType: null, profilePhotoUpdatedAt: null }
    });
    expect(mocks.deleteObject).toHaveBeenCalledWith("attachments", "users/user-1/profile-photo/old.webp");
  });

  it("is idempotent when no photo exists", async () => {
    const res = await removePhoto();
    expect(res.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});

describe("GET /api/account/profile-photo/image", () => {
  it("rejects unauthenticated fetches", async () => {
    mocks.requireUser.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "nope" }), { status: 401 })
    });

    const res = await servePhoto();
    expect(res.status).toBe(401);
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("404s when the user has no photo", async () => {
    const res = await servePhoto();
    expect(res.status).toBe(404);
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("serves only the session user's own photo from the attachments bucket", async () => {
    mocks.requireUser.mockResolvedValue({
      user: {
        ...baseUser,
        profilePhotoKey: "users/user-1/profile-photo/current.png",
        profilePhotoContentType: "image/png"
      }
    });
    mocks.getObjectBuffer.mockResolvedValue(Buffer.from(PNG_BYTES));

    const res = await servePhoto();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(mocks.getObjectBuffer).toHaveBeenCalledWith("attachments", "users/user-1/profile-photo/current.png");
  });

  it("never reads an arbitrary storage key — the handler takes no request input", () => {
    // The key always comes from the authenticated user's record; there is no
    // ?key= or ?userId= surface to abuse.
    expect(servePhoto.length).toBe(0);
  });

  it("404s instead of erroring when the stored object is missing", async () => {
    mocks.requireUser.mockResolvedValue({
      user: {
        ...baseUser,
        profilePhotoKey: "users/user-1/profile-photo/gone.png",
        profilePhotoContentType: "image/png"
      }
    });
    mocks.getObjectBuffer.mockRejectedValue(new Error("NoSuchKey"));

    const res = await servePhoto();
    expect(res.status).toBe(404);
  });
});
