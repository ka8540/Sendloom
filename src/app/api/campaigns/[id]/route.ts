import { NextResponse } from "next/server";
import { z } from "zod";

import { createForbiddenApiResponse, getApiRestrictionMessage, requireApiUser } from "@/lib/api-auth";
import type { EmailAttachment } from "@/lib/provider";
import { GMAIL_RECONNECT_ERROR } from "@/lib/provider";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { storeUpload } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ScheduleRule } from "@/lib/types";
import { deleteCampaign, updateCampaignSchedule, updateCampaignSetup } from "@/services/campaigns";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const recurringScheduleRuleSchema = z
  .object({
    type: z.literal("recurring"),
    frequency: z.enum(["daily", "weekly"]),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    timeZone: z.string().min(1).optional()
  })
  .superRefine((rule, context) => {
    if (rule.frequency === "weekly" && !(rule.daysOfWeek?.length || rule.dayOfWeek !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one day.",
        path: ["daysOfWeek"]
      });
    }
  });

const scheduleRuleSchema = z.union([
  z.object({ type: z.literal("immediate") }),
  z.object({
    type: z.literal("once"),
    scheduledFor: z.string().min(1),
    timeZone: z.string().min(1).optional()
  }),
  recurringScheduleRuleSchema
]);

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

  const limit = await rateLimit({ key: `campaigns:update:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const { id } = await context.params;
  const formData = await request.formData();

  if (formData.has("scheduleRule")) {
    let rawScheduleRule: unknown;
    try {
      rawScheduleRule = JSON.parse(String(formData.get("scheduleRule") ?? "{}"));
    } catch {
      return NextResponse.json({ error: "Schedule data could not be read." }, { status: 400 });
    }

    const parsedScheduleRule = scheduleRuleSchema.safeParse(rawScheduleRule);
    if (!parsedScheduleRule.success) {
      return NextResponse.json({ error: "Choose a valid send schedule." }, { status: 400 });
    }

    const scheduleRule = parsedScheduleRule.data as ScheduleRule;
    if (scheduleRule.type === "once" && new Date(scheduleRule.scheduledFor) <= new Date()) {
      return NextResponse.json({ error: "Choose a future time for a one-time scheduled send." }, { status: 400 });
    }

    const launchRestrictionMessage = getApiRestrictionMessage(auth.user, "campaignLaunch");
    if (launchRestrictionMessage) {
      return createForbiddenApiResponse(launchRestrictionMessage);
    }

    try {
      const updatedCampaign = await updateCampaignSchedule(
        {
          campaignId: id,
          scheduleRule
        },
        auth.user.id
      );

      await writeAuditLog({
        actorEmail: auth.user.email,
        action: "campaign.schedule.update",
        entityType: "campaign",
        entityId: id
      });

      return NextResponse.json(updatedCampaign);
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ error: "Could not save the sequence schedule." }, { status: 500 });
    }
  }

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

  const limit = await rateLimit({ key: `campaigns:delete:user:${auth.user.id}`, limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
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
