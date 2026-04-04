import { NextResponse } from "next/server";

import type { EmailAttachment } from "@/lib/provider";
import { GMAIL_RECONNECT_ERROR } from "@/lib/provider";
import { storeUpload } from "@/lib/storage";
import { requireApiUser } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { deleteCampaign, updateCampaignSetup } from "@/services/campaigns";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type AttachmentPlanItem =
  | {
      type: "existing";
      sourceIndex: number;
    }
  | {
      type: "upload";
      fileField: string;
    };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const importId = String(formData.get("importId") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const senderProfileId = String(formData.get("senderProfileId") ?? "").trim();
  const rawPlan = String(formData.get("attachmentsPlan") ?? "[]");

  if (!name || !importId || !templateId || !senderProfileId) {
    return NextResponse.json({ error: "Complete every required field before saving." }, { status: 400 });
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

  const currentAttachments: EmailAttachment[] =
    campaign?.templateSnapshot &&
    typeof campaign.templateSnapshot === "object" &&
    !Array.isArray(campaign.templateSnapshot) &&
    Array.isArray((campaign.templateSnapshot as { attachments?: unknown }).attachments)
      ? ((campaign.templateSnapshot as { attachments?: EmailAttachment[] }).attachments ?? [])
      : [];

  let plan: AttachmentPlanItem[] = [];
  try {
    plan = JSON.parse(rawPlan) as AttachmentPlanItem[];
  } catch {
    return NextResponse.json({ error: "Attachment data could not be read." }, { status: 400 });
  }

  const attachments: EmailAttachment[] = [];
  for (const item of plan) {
    if (item.type === "existing") {
      const existingAttachment = currentAttachments[item.sourceIndex];
      if (!existingAttachment || typeof existingAttachment.fileName !== "string") {
        return NextResponse.json({ error: "Attachment reference is no longer valid." }, { status: 400 });
      }

      attachments.push(existingAttachment);
      continue;
    }

    if (item.type === "upload") {
      const file = formData.get(item.fileField);
      if (!(file instanceof File) || file.size <= 0) {
        return NextResponse.json({ error: "Attachment upload is missing." }, { status: 400 });
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "Attachments must be 10 MB or smaller." }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      attachments.push(
        process.env.VERCEL
          ? {
              fileName: file.name,
              contentBase64: buffer.toString("base64"),
              contentType: file.type || null
            }
          : {
              fileName: file.name,
              storagePath: await storeUpload(file.name, buffer, "attachments"),
              contentType: file.type || null
            }
      );
    }
  }

  try {
    const updatedCampaign = await updateCampaignSetup(
      {
        campaignId: id,
        name,
        importId,
        templateId,
        senderProfileId,
        attachments
      },
      auth.user.id
    );

    await writeAuditLog({
      actorEmail: auth.user.email,
      action: "campaign.update",
      entityType: "campaign",
      entityId: id
    });

    return NextResponse.json({ campaign: updatedCampaign });
  } catch (error) {
    if (error instanceof Error && error.message === GMAIL_RECONNECT_ERROR) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Could not save the sequence setup." }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;
  const result = await deleteCampaign(id, auth.user.id);
  await writeAuditLog({
    actorEmail: auth.user.email,
    action: "campaign.delete",
    entityType: "campaign",
    entityId: id
  });

  return NextResponse.json(result);
}
