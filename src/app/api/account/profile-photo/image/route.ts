import { requireApiUser } from "@/lib/api-auth";
import { getObjectBuffer } from "@/lib/storage";

// Serves ONLY the authenticated user's own profile photo. The object key comes
// from the session user's record — the request can never ask for an arbitrary
// key or another user's photo, which keeps the shared attachments bucket
// (resumes/files included) private.

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(): Promise<Response> {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response ?? Response.json({ error: "Authentication is required." }, { status: 401 });
  }

  const key = auth.user.profilePhotoKey;
  const storedType = auth.user.profilePhotoContentType;
  if (!key || !storedType || !ALLOWED_CONTENT_TYPES.has(storedType)) {
    return Response.json({ error: "No profile photo is set." }, { status: 404 });
  }

  let body: Buffer;
  try {
    body = await getObjectBuffer("attachments", key);
  } catch {
    return Response.json({ error: "Profile photo is unavailable." }, { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": storedType,
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      // Private per-user cache; the ?v=<updatedAt> query busts it on change.
      "Cache-Control": "private, max-age=3600"
    }
  });
}
