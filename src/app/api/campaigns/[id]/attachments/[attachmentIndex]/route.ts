import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { getAttachmentContentType } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import { getObjectBuffer } from "@/lib/storage";
import type { EmailAttachment } from "@/lib/provider";

type CampaignTemplateSnapshot = {
  attachments?: EmailAttachment[];
};

// MIME types we are willing to render `inline` in the browser. Everything else
// is force-downloaded so that an `.html`, `.svg`, `.xml`, `.js`, etc. file
// uploaded by a user cannot be rendered as same-origin content in the app.
const INLINE_SAFE_PREFIXES = ["image/", "audio/", "video/"] as const;
const INLINE_SAFE_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "text/plain; charset=utf-8"
]);

function isInlineSafe(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (INLINE_SAFE_EXACT.has(normalized)) return true;
  return INLINE_SAFE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function createNotFoundResponse() {
  return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
}

function buildContentDisposition(fileName: string, forceDownload: boolean) {
  // RFC 5987 / RFC 6266 safe Content-Disposition. Use a stripped ASCII
  // fallback for the legacy `filename=` and the percent-encoded UTF-8
  // form for `filename*=`. Disallow any CR/LF in either form to prevent
  // header injection.
  const safeAscii = fileName
    .replace(/[\r\n"\\]+/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 200) || "attachment";
  const utf8 = encodeURIComponent(fileName).replace(/['()]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  const disposition = forceDownload ? "attachment" : "inline";
  return `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentIndex: string }> }
) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id, attachmentIndex } = await context.params;
  const index = Number.parseInt(attachmentIndex, 10);

  if (!Number.isInteger(index) || index < 0) {
    return createNotFoundResponse();
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: auth.user.id
    },
    select: {
      templateSnapshot: true
    }
  });

  if (!campaign) {
    return createNotFoundResponse();
  }

  const attachments = ((campaign.templateSnapshot as CampaignTemplateSnapshot | null)?.attachments ?? []).filter(
    (attachment) => attachment.fileName
  );
  const attachment = attachments[index];

  if (!attachment) {
    return createNotFoundResponse();
  }

  let contents: Buffer;

  try {
    if (attachment.contentBase64) {
      contents = Buffer.from(attachment.contentBase64, "base64");
    } else if (attachment.storagePath) {
      contents = await getObjectBuffer("attachments", attachment.storagePath);
    } else {
      return createNotFoundResponse();
    }
  } catch {
    return createNotFoundResponse();
  }

  // Derive Content-Type from the filename extension by default; the uploaded
  // MIME is only consulted as a hint, never as the authority (Finding 10).
  const fallbackContentType = getAttachmentContentType(attachment.fileName, null);
  const declared = (attachment.contentType ?? "").toLowerCase();
  const effectiveContentType = isInlineSafe(declared) ? declared : fallbackContentType;

  const { searchParams } = new URL(request.url);
  const requestedDownload = searchParams.get("download") === "1";
  const forceDownload = requestedDownload || !isInlineSafe(effectiveContentType);

  return new NextResponse(new Uint8Array(contents), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": buildContentDisposition(attachment.fileName, forceDownload),
      "Content-Type": effectiveContentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
