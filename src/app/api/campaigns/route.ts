import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { storeUpload } from "@/lib/storage";
import { createCampaignDraft, launchCampaign, processPendingCampaignWork, validateCampaign } from "@/services/campaigns";

export const maxDuration = 60;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const scheduleRuleSchema = z.union([
  z.object({ type: z.literal("immediate") }),
  z.object({
    type: z.literal("once"),
    scheduledFor: z.string(),
    timeZone: z.string().optional()
  }),
  z.object({
    type: z.literal("recurring"),
    frequency: z.enum(["daily", "weekly"]),
    time: z.string(),
    dayOfWeek: z.number().optional(),
    timeZone: z.string().optional()
  })
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
  const user = await getSessionUser();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const formData = await request.formData();
  const attachment = formData.get("attachment");
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

  const sender = await prisma.senderProfile.findFirst({
    where: {
      id: payload.senderProfileId,
      userId: user.id
    }
  });

  if (!sender) {
    return NextResponse.json({ error: "Choose a Gmail sender connected to your account." }, { status: 403 });
  }

  let attachments:
    | {
        fileName: string;
        storagePath?: string;
        contentBase64?: string;
        contentType?: string | null;
      }[]
    | undefined;

  if (attachment instanceof File && attachment.size > 0) {
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Attachments must be 10 MB or smaller." }, { status: 400 });
    }

    const buffer = Buffer.from(await attachment.arrayBuffer());
    attachments = [
      process.env.VERCEL
        ? {
            fileName: attachment.name,
            contentBase64: buffer.toString("base64"),
            contentType: attachment.type || null
          }
        : {
            fileName: attachment.name,
            storagePath: await storeUpload(attachment.name, buffer, "attachments"),
            contentType: attachment.type || null
          }
    ];
  }

  const campaign = await createCampaignDraft(
    {
      ...payload,
      attachments
    },
    user.id
  );

  if (payload.autoLaunch && payload.scheduleRule.type === "immediate") {
    await validateCampaign(campaign.id, user.id);
    const run = await launchCampaign(campaign.id, user.id);
    after(async () => {
      await processPendingCampaignWork({
        runId: run.id,
        maxDurationMs: 55_000
      });
    });
    return NextResponse.json({ campaignId: campaign.id, runId: run.id, autoLaunched: true });
  }

  if (payload.scheduleRule.type === "once" || payload.scheduleRule.type === "recurring") {
    const run = await launchCampaign(campaign.id, user.id);
    return NextResponse.json({
      campaignId: campaign.id,
      runId: run.id,
      autoLaunched: false,
      autoScheduled: true
    });
  }

  return NextResponse.json({ campaignId: campaign.id, autoLaunched: false, autoScheduled: false });
}
