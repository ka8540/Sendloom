import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  PROFILE_PHOTO_INVALID_TYPE_MESSAGE,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_REMOVE_ERROR_MESSAGE,
  PROFILE_PHOTO_TOO_LARGE_MESSAGE,
  PROFILE_PHOTO_UPDATE_ERROR_MESSAGE,
  buildProfilePhotoImageUrl,
  detectProfilePhotoType
} from "@/lib/account";
import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { buildProfilePhotoKey, deleteObject, uploadObject } from "@/lib/storage";

// The photo always belongs to the authenticated user — the browser can never
// supply a userId, storage key, or bucket.

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const userLimit = await rateLimit({
    key: `account:profile-photo:user:${auth.user.id}`,
    limit: 10,
    windowSeconds: 60 * 15
  });
  if (!userLimit.allowed) {
    return createRateLimitResponse(userLimit.retryAfterSeconds);
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: PROFILE_PHOTO_INVALID_TYPE_MESSAGE }, { status: 400 });
  }

  if (file.size <= 0 || file.size > PROFILE_PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: PROFILE_PHOTO_TOO_LARGE_MESSAGE }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Validate the actual bytes — the client-supplied MIME type and filename
  // are conveniences, never proof of content.
  const detected = detectProfilePhotoType(buffer);
  if (!detected) {
    return NextResponse.json({ error: PROFILE_PHOTO_INVALID_TYPE_MESSAGE }, { status: 400 });
  }

  const previousKey = auth.user.profilePhotoKey;
  const newKey = buildProfilePhotoKey(auth.user.id, randomUUID(), detected.extension);

  try {
    await uploadObject({
      bucket: "attachments",
      key: newKey,
      body: buffer,
      contentType: detected.contentType
    });
  } catch {
    console.error("[account] Profile photo upload to storage failed.");
    return NextResponse.json({ error: PROFILE_PHOTO_UPDATE_ERROR_MESSAGE }, { status: 500 });
  }

  let updatedAt: Date;
  try {
    const updated = await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        profilePhotoKey: newKey,
        profilePhotoContentType: detected.contentType,
        profilePhotoUpdatedAt: new Date()
      },
      select: { profilePhotoUpdatedAt: true }
    });
    updatedAt = updated.profilePhotoUpdatedAt ?? new Date();
  } catch {
    // The DB never points at the new object, so remove it rather than leaving
    // an unreferenced upload behind.
    await deleteObject("attachments", newKey).catch(() => undefined);
    console.error("[account] Profile photo record update failed.");
    return NextResponse.json({ error: PROFILE_PHOTO_UPDATE_ERROR_MESSAGE }, { status: 500 });
  }

  // Only after the DB points at the new photo is the old object removed —
  // a failed cleanup leaves an orphan but never a broken avatar.
  if (previousKey && previousKey !== newKey) {
    await deleteObject("attachments", previousKey).catch(() => undefined);
  }

  return NextResponse.json({ profilePhotoUrl: buildProfilePhotoImageUrl(updatedAt) });
}

export async function DELETE(): Promise<Response> {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const userLimit = await rateLimit({
    key: `account:profile-photo:user:${auth.user.id}`,
    limit: 10,
    windowSeconds: 60 * 15
  });
  if (!userLimit.allowed) {
    return createRateLimitResponse(userLimit.retryAfterSeconds);
  }

  const previousKey = auth.user.profilePhotoKey;

  try {
    await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        profilePhotoKey: null,
        profilePhotoContentType: null,
        profilePhotoUpdatedAt: null
      }
    });
  } catch {
    console.error("[account] Profile photo removal failed.");
    return NextResponse.json({ error: PROFILE_PHOTO_REMOVE_ERROR_MESSAGE }, { status: 500 });
  }

  if (previousKey) {
    await deleteObject("attachments", previousKey).catch(() => undefined);
  }

  return NextResponse.json({ profilePhotoUrl: null });
}
