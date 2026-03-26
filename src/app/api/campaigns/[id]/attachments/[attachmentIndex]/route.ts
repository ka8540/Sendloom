import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth";
import { getAttachmentContentType } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import type { EmailAttachment } from "@/lib/provider";

type CampaignTemplateSnapshot = {
  attachments?: EmailAttachment[];
};

function createNotFoundResponse() {
  return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
}

function getAttachmentDisposition(fileName: string, download = false) {
  const safeFileName = fileName.replace(/"/g, "");
  const type = download ? "attachment" : "inline";

  return `${type}; filename="${safeFileName}"`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentIndex: string }> }
) {
  const user = await getSessionUser();

  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const { id, attachmentIndex } = await context.params;
  const index = Number.parseInt(attachmentIndex, 10);

  if (!Number.isInteger(index) || index < 0) {
    return createNotFoundResponse();
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: user.id
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
      contents = await readFile(attachment.storagePath);
    } else {
      return createNotFoundResponse();
    }
  } catch {
    return createNotFoundResponse();
  }

  const { searchParams } = new URL(request.url);
  const download = searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(contents), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": getAttachmentDisposition(attachment.fileName, download),
      "Content-Type": getAttachmentContentType(attachment.fileName, attachment.contentType)
    }
  });
}
