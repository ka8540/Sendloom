import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createForbiddenApiResponse, getApiRestrictionMessage, requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { getAttachmentFilesFromFormData } from "@/lib/campaign-attachments";
import { prisma } from "@/lib/db";
import { GMAIL_RECONNECT_ERROR } from "@/lib/provider";
import type { EmailAttachment } from "@/lib/provider";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { findOrCreateAttachmentAsset, toAttachmentSnapshot } from "@/services/attachment-assets";
import { CampaignLaunchBlockedError, createCampaignDraft, launchCampaign, processPendingCampaignWork } from "@/services/campaigns";
import { SequenceConcurrencyLimitError, SequenceStorageLimitError } from "@/services/sequence-limits";

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

  let attachments: EmailAttachment[] | undefined;

  for (const attachment of attachmentFiles) {
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Attachments must be 10 MB or smaller." }, { status: 400 });
    }
  }

  let campaign;
  try {
    campaign = await createCampaignDraft(
      {
        ...payload,
        prepareAttachments: async () => {
          attachments = [];
          for (const attachment of attachmentFiles) {
            const buffer = Buffer.from(await attachment.arrayBuffer());
            const { asset } = await findOrCreateAttachmentAsset({
              userId: auth.user.id,
              buffer,
              fileName: attachment.name,
              contentType: attachment.type
            });
            attachments.push(toAttachmentSnapshot(asset, attachment.name, attachment.type));
          }
          return attachments;
        }
      },
      auth.user.id
    );
  } catch (error) {
    if (error instanceof SequenceStorageLimitError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }

  await recordAuditEvent({
    actor: { id: auth.user.id, email: auth.user.email },
    action: "sequence.created",
    category: "SEQUENCE",
    severity: "SUCCESS",
    target: { type: "sequence", id: campaign.id, name: payload.name },
    message: `Created sequence ${payload.name}.`,
    metadata: { scheduleType: payload.scheduleRule.type, attachmentCount: attachments?.length ?? 0 },
    request
  });

  if (attachments?.length) {
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "file.attachments_uploaded",
      category: "FILE",
      target: { type: "sequence", id: campaign.id, name: payload.name },
      message: `Uploaded ${attachments.length} attachment${attachments.length === 1 ? "" : "s"} for ${payload.name}.`,
      metadata: { fileNames: attachments.map((attachment) => attachment.fileName) },
      request
    });
  }

  if (payload.autoLaunch && payload.scheduleRule.type === "immediate") {
    let run;
    try {
      run = await launchCampaign(campaign.id, auth.user.id);
    } catch (error) {
      if (error instanceof SequenceConcurrencyLimitError) {
        return NextResponse.json(
          { error: error.message, code: error.code, campaignId: campaign.id },
          { status: 409 }
        );
      }
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
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "sequence.launched",
      category: "SEQUENCE",
      severity: "SUCCESS",
      target: { type: "sequence", id: campaign.id, name: payload.name },
      message: `Launched sequence ${payload.name} (${run.totalRecipients} recipients).`,
      metadata: { runId: run.id, recipients: run.totalRecipients },
      request
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
    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: "sequence.scheduled",
      category: "SEQUENCE",
      severity: "SUCCESS",
      target: { type: "sequence", id: campaign.id, name: payload.name },
      message: `Scheduled sequence ${payload.name} (${payload.scheduleRule.type}).`,
      metadata: { runId: run.id, scheduleType: payload.scheduleRule.type },
      request
    });
    return NextResponse.json({
      campaignId: campaign.id,
      runId: run.id,
      autoLaunched: false,
      autoScheduled: true
    });
  }

  return NextResponse.json({ campaignId: campaign.id, autoLaunched: false, autoScheduled: false });
}
