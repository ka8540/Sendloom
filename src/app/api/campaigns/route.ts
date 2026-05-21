import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createForbiddenApiResponse, getApiRestrictionMessage, requireApiUser } from "@/lib/api-auth";
import { getAttachmentFilesFromFormData } from "@/lib/campaign-attachments";
import { prisma } from "@/lib/db";
import { GMAIL_RECONNECT_ERROR } from "@/lib/provider";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { buildAttachmentKey, uploadObject } from "@/lib/storage";
import { CampaignLaunchBlockedError, createCampaignDraft, launchCampaign, processPendingCampaignWork } from "@/services/campaigns";

export const maxDuration = 60;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const recurringScheduleRuleSchema = z
  .object({
    type: z.literal("recurring"),
    frequency: z.enum(["daily", "weekly"]),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    timeZone: z.string().optional()
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
    scheduledFor: z.string(),
    timeZone: z.string().optional()
  }),
  recurringScheduleRuleSchema
]);

const schema = z.object({
  name: z.string().min(1),
  importId: z.string(),
  mappingId: z.string(),
  templateId: z.string(),
  senderProfileId: z.string(),
  scheduleRule: scheduleRuleSchema,
  autoLaunch: z.boolean().optional()
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const limit = await rateLimit({ key: `campaigns:create:user:${auth.user.id}`, limit: 20, windowSeconds: 60 });
  if (!limit.allowed) {
    return createRateLimitResponse(limit.retryAfterSeconds);
  }

  const formData = await request.formData();
  const attachmentFiles = getAttachmentFilesFromFormData(formData);
  const payload = schema.parse({
    name: formData.get("name"),
    importId: formData.get("importId"),
    mappingId: formData.get("mappingId"),
    templateId: formData.get("templateId"),
    senderProfileId: formData.get("senderProfileId"),
    scheduleRule: JSON.parse(String(formData.get("scheduleRule") ?? "{}")),
    autoLaunch: formData.get("autoLaunch") === "true"
  });

  if (payload.scheduleRule.type === "once" && new Date(payload.scheduleRule.scheduledFor) <= new Date()) {
    return NextResponse.json({ error: "Choose a future time for a one-time scheduled send." }, { status: 400 });
  }

  const launchRestrictionMessage = getApiRestrictionMessage(auth.user, "campaignLaunch");
  const wouldLaunchOrSchedule = payload.autoLaunch || payload.scheduleRule.type === "once" || payload.scheduleRule.type === "recurring";
  if (launchRestrictionMessage && wouldLaunchOrSchedule) {
    return createForbiddenApiResponse(launchRestrictionMessage);
  }

  const sender = await prisma.senderProfile.findFirst({
    where: {
      id: payload.senderProfileId,
      userId: auth.user.id
    }
  });

  if (!sender) {
    return NextResponse.json({ error: "Choose a Gmail sender connected to your account." }, { status: 403 });
  }

  if (!sender.oauthRefreshToken) {
    return NextResponse.json(
      {
        error: GMAIL_RECONNECT_ERROR
      },
      { status: 400 }
    );
  }

  let attachments:
    | {
        fileName: string;
        storagePath?: string;
        contentBase64?: string;
        contentType?: string | null;
      }[]
    | undefined;

  if (attachmentFiles.length) {
    attachments = [];

    for (const attachment of attachmentFiles) {
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "Attachments must be 10 MB or smaller." }, { status: 400 });
      }

      const buffer = Buffer.from(await attachment.arrayBuffer());
      const upload = await uploadObject({
        bucket: "attachments",
        key: buildAttachmentKey(auth.user.id, attachment.name),
        body: buffer,
        contentType: attachment.type || undefined
      });
      attachments.push({
        fileName: attachment.name,
        storagePath: upload.key,
        contentType: attachment.type || null
      });
    }
  }

  const campaign = await createCampaignDraft(
    {
      ...payload,
      attachments
    },
    auth.user.id
  );

  if (payload.autoLaunch && payload.scheduleRule.type === "immediate") {
    let run;
    try {
      run = await launchCampaign(campaign.id, auth.user.id);
    } catch (error) {
      if (error instanceof CampaignLaunchBlockedError) {
        return NextResponse.json(
          {
            error: error.message,
            campaignId: campaign.id,
            validation: error.report
          },
          { status: 409 }
        );
      }

      throw error;
    }
    after(async () => {
      await processPendingCampaignWork({
        runId: run.id,
        maxDurationMs: 55_000
      });
    });
    return NextResponse.json({ campaignId: campaign.id, runId: run.id, autoLaunched: true });
  }

  if (payload.scheduleRule.type === "once" || payload.scheduleRule.type === "recurring") {
    let run;
    try {
      run = await launchCampaign(campaign.id, auth.user.id);
    } catch (error) {
      if (error instanceof CampaignLaunchBlockedError) {
        return NextResponse.json(
          {
            error: error.message,
            campaignId: campaign.id,
            validation: error.report
          },
          { status: 409 }
        );
      }

      throw error;
    }
    return NextResponse.json({
      campaignId: campaign.id,
      runId: run.id,
      autoLaunched: false,
      autoScheduled: true
    });
  }

  return NextResponse.json({ campaignId: campaign.id, autoLaunched: false, autoScheduled: false });
}
