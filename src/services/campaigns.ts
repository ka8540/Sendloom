import { addMinutes } from "date-fns";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { buildMergePayload } from "@/lib/mapping";
import { queues } from "@/lib/queue";
import { getNextRunDate } from "@/lib/schedule";
import type { EmailAttachment } from "@/lib/provider";
import { renderTemplate } from "@/lib/templates";
import { makeTrackingUrl, shaKey } from "@/lib/tracking";
import type { CampaignValidationReport, ScheduleRule } from "@/lib/types";
import { buildValidationReport } from "@/lib/validation";
import { getSuppressedEmailSet, suppressEmail } from "@/services/suppressions";

function campaignOwnershipFilter(campaignId: string, userId?: string) {
  return {
    id: campaignId,
    ...(userId ? { userId } : {})
  };
}

async function getSuppressedEmailsForUser(userId: string | null) {
  return userId ? getSuppressedEmailSet(userId) : new Set<string>();
}

type CampaignAttachmentSnapshot = EmailAttachment;

type CampaignTemplateSnapshot = {
  subject: string;
  htmlBody: string;
  variableManifest: unknown;
  attachments?: CampaignAttachmentSnapshot[];
};

export async function createCampaignDraft(input: {
  name: string;
  importId: string;
  mappingId: string;
  templateId: string;
  senderProfileId: string;
  scheduleRule: ScheduleRule;
  attachments?: CampaignAttachmentSnapshot[];
}, userId: string) {
  const [importRecord, template, mapping, senderProfile] = await Promise.all([
    prisma.import.findFirstOrThrow({
      where: {
        id: input.importId,
        userId
      }
    }),
    prisma.template.findFirstOrThrow({
      where: {
        id: input.templateId,
        userId
      }
    }),
    prisma.mapping.findFirstOrThrow({
      where: {
        id: input.mappingId,
        importId: input.importId,
        userId
      }
    }),
    prisma.senderProfile.findFirstOrThrow({
      where: {
        id: input.senderProfileId,
        userId
      }
    })
  ]);

  return prisma.campaign.create({
    data: {
      userId,
      name: input.name,
      importId: importRecord.id,
      mappingId: mapping.id,
      templateId: input.templateId,
      senderProfileId: input.senderProfileId,
      scheduleType: input.scheduleRule.type,
      scheduleConfig: input.scheduleRule,
      templateSnapshot: {
        subject: template.subject,
        htmlBody: template.htmlBody,
        variableManifest: template.variableManifest,
        attachments: input.attachments ?? []
      },
      mappingSnapshot: {
        reservedFieldMap: mapping.reservedFieldMap,
        variableMap: mapping.variableMap
      },
      senderSnapshot: {
        fromEmail: senderProfile.fromEmail,
        name: senderProfile.name
      }
    }
  });
}

export async function validateCampaign(campaignId: string, userId?: string): Promise<CampaignValidationReport> {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    include: {
      import: {
        include: {
          rows: true
        }
      }
    }
  });

  const suppressedEmails = await getSuppressedEmailsForUser(campaign.userId);
  const templateSnapshot = campaign.templateSnapshot as CampaignTemplateSnapshot;
  const report = buildValidationReport({
    rows: campaign.import.rows.map((row) => {
      const payload = buildMergePayload(row.normalized as Record<string, unknown>, campaign.mappingSnapshot as {
        reservedFieldMap?: Record<string, string>;
        variableMap?: Record<string, string>;
      });

      return {
        rowIndex: row.rowIndex,
        email: typeof payload.email === "string" ? payload.email : row.email,
        payload
      };
    }),
    templateSubject: templateSnapshot.subject,
    templateHtml: templateSnapshot.htmlBody,
    suppressedEmails
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "VALIDATED",
      lastValidatedAt: new Date(),
      validationSnapshot: report
    }
  });

  return report;
}

export async function launchCampaign(campaignId: string, userId?: string) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    include: {
      import: {
        include: {
          rows: true
        }
      }
    }
  });

  const activeRun = await prisma.campaignRun.findFirst({
    where: {
      campaignId,
      status: {
        in: ["QUEUED", "RUNNING", "PAUSED"]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (activeRun) {
    return activeRun;
  }

  const rule = campaign.scheduleConfig as ScheduleRule;
  const scheduledFor = getNextRunDate(rule);
  const totalRecipients = campaign.import.rows.length;

  const run = await prisma.campaignRun.create({
    data: {
      campaignId,
      status: rule.type === "immediate" ? "RUNNING" : "QUEUED",
      launchType: rule.type,
      scheduledFor,
      startedAt: rule.type === "immediate" ? new Date() : null,
      totalRecipients
    }
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: rule.type === "immediate" ? "RUNNING" : "SCHEDULED"
    }
  });

  await queues.launch.add(
    "launch-run",
    {
      campaignId,
      runId: run.id
    },
    {
      jobId: run.id,
      delay: Math.max(0, scheduledFor.getTime() - Date.now())
    }
  );

  return run;
}

export async function enqueueRecipientJobs(campaignId: string, runId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      import: { include: { rows: true } }
    }
  });

  const suppressedEmails = await getSuppressedEmailsForUser(campaign.userId);
  const templateSnapshot = campaign.templateSnapshot as CampaignTemplateSnapshot;
  const subjectTemplate = templateSnapshot.subject;
  const htmlTemplate = templateSnapshot.htmlBody;
  const mappingSnapshot = campaign.mappingSnapshot as {
    reservedFieldMap?: Record<string, string>;
    variableMap?: Record<string, string>;
  };

  for (const row of campaign.import.rows) {
    const payload = buildMergePayload(row.normalized as Record<string, unknown>, mappingSnapshot);
    const emailFromPayload = typeof payload.email === "string" ? payload.email : null;
    const email = emailFromPayload?.toLowerCase() ?? row.email?.toLowerCase();

    if (!email) {
      continue;
    }

    const metadata: Record<string, unknown> = {
      rowIndex: row.rowIndex
    };

    if (suppressedEmails.has(email)) {
      await prisma.recipientJob.create({
        data: {
          campaignRunId: runId,
          importRowId: row.id,
          recipientEmail: email,
          recipientName: typeof payload.name === "string" ? payload.name : null,
          subject: renderTemplate(subjectTemplate, payload),
          htmlBody: renderTemplate(htmlTemplate, payload),
          dedupeKey: shaKey([runId, email]),
          status: "SUPPRESSED",
          metadata: metadata as Prisma.InputJsonValue
        }
      });
      continue;
    }

    const subject = renderTemplate(subjectTemplate, payload);
    const renderedHtml = renderTemplate(htmlTemplate, payload);

    const jobRecord = await prisma.recipientJob.create({
      data: {
        campaignRunId: runId,
        importRowId: row.id,
        recipientEmail: email,
        recipientName: typeof payload.name === "string" ? payload.name : null,
        subject,
        htmlBody: renderedHtml,
        dedupeKey: shaKey([runId, email]),
        metadata: metadata as Prisma.InputJsonValue
      }
    });

    const unsubscribeUrl = makeTrackingUrl("unsubscribe", jobRecord.id, email);
    const openUrl = makeTrackingUrl("open", jobRecord.id, email);
    const html = [
      renderedHtml,
      `<img src="${openUrl}" alt="" width="1" height="1" style="display:none" />`,
      `<p style="font-size:12px;color:#6b7280">You can <a href="${unsubscribeUrl}">unsubscribe</a> at any time.</p>`
    ].join("");

    await prisma.recipientJob.update({
      where: { id: jobRecord.id },
      data: {
        htmlBody: html
      }
    });

    await queues.send.add(
      "send-recipient",
      {
        jobId: jobRecord.id
      },
      {
        jobId: jobRecord.dedupeKey,
        attempts: 1
      }
    );
  }
}

export async function markRecipientAttempt(args: {
  jobId: string;
  status: "SENT" | "FAILED" | "RETRYING" | "INVALID";
  providerMessageId?: string;
  lastError?: string;
}) {
  const updated = await prisma.recipientJob.update({
    where: { id: args.jobId },
    data: {
      status: args.status,
      providerMessageId: args.providerMessageId,
      lastError: args.lastError,
      retryCount: args.status === "RETRYING" ? { increment: 1 } : undefined,
      nextRetryAt: args.status === "RETRYING" ? addMinutes(new Date(), 5) : null
    }
  });

  const aggregate = await prisma.recipientJob.groupBy({
    by: ["status"],
    where: { campaignRunId: updated.campaignRunId },
    _count: true
  });

  const counts = Object.fromEntries(aggregate.map((entry) => [entry.status, entry._count]));
  await prisma.campaignRun.update({
    where: { id: updated.campaignRunId },
    data: {
      sentCount: counts.SENT ?? 0,
      failedCount: counts.FAILED ?? 0,
      suppressedCount: counts.SUPPRESSED ?? 0,
      invalidCount: counts.INVALID ?? 0,
      openedCount: counts.OPENED ?? 0,
      clickedCount: counts.CLICKED ?? 0
    }
  });

  return updated;
}

export async function getCampaignStatus(campaignId: string, userId?: string) {
  return prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          recipientJobs: {
            take: 100,
            orderBy: { updatedAt: "desc" }
          }
        }
      }
    }
  });
}

export async function processProviderEvent(args: {
  provider: string;
  providerMessageId: string;
  eventType: "ACCEPTED" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "OPENED" | "CLICKED";
  payload: Record<string, unknown>;
}) {
  await prisma.providerEvent.upsert({
    where: {
      provider_providerMessageId_eventType: {
        provider: args.provider,
        providerMessageId: args.providerMessageId,
        eventType: args.eventType
      }
    },
    update: {
      payload: args.payload as Prisma.InputJsonValue
    },
    create: {
      provider: args.provider,
      providerMessageId: args.providerMessageId,
      eventType: args.eventType,
      payload: args.payload as Prisma.InputJsonValue
    }
  });

  const recipientJob = await prisma.recipientJob.findFirst({
    where: { providerMessageId: args.providerMessageId },
    include: {
      campaignRun: {
        include: {
          campaign: {
            select: {
              userId: true
            }
          }
        }
      }
    }
  });

  if (!recipientJob) {
    return null;
  }

  if (args.eventType === "BOUNCED") {
    if (recipientJob.campaignRun.campaign.userId) {
      await suppressEmail(recipientJob.campaignRun.campaign.userId, recipientJob.recipientEmail, "HARD_BOUNCE", "provider-webhook");
    }
    return markRecipientAttempt({ jobId: recipientJob.id, status: "FAILED", lastError: "Hard bounce" });
  }

  if (args.eventType === "COMPLAINED") {
    if (recipientJob.campaignRun.campaign.userId) {
      await suppressEmail(recipientJob.campaignRun.campaign.userId, recipientJob.recipientEmail, "COMPLAINT", "provider-webhook");
    }
    return markRecipientAttempt({ jobId: recipientJob.id, status: "FAILED", lastError: "Complaint received" });
  }

  if (args.eventType === "OPENED" || args.eventType === "CLICKED") {
    return prisma.recipientJob.update({
      where: { id: recipientJob.id },
      data: {
        status: args.eventType === "CLICKED" ? "CLICKED" : "OPENED"
      }
    });
  }

  return recipientJob;
}

export async function queueRecurringRuns() {
  const scheduledCampaigns = await prisma.campaign.findMany({
    where: {
      scheduleType: "recurring",
      status: {
        in: ["SCHEDULED", "COMPLETED"]
      }
    }
  });

  for (const campaign of scheduledCampaigns) {
    const rule = campaign.scheduleConfig as ScheduleRule;
    const nextRunDate = getNextRunDate(rule);
    const existingRun = await prisma.campaignRun.findFirst({
      where: {
        campaignId: campaign.id,
        scheduledFor: nextRunDate
      }
    });

    if (existingRun) {
      continue;
    }

    const run = await prisma.campaignRun.create({
      data: {
        campaignId: campaign.id,
        status: "QUEUED",
        launchType: "recurring",
        scheduledFor: nextRunDate
      }
    });

    await queues.launch.add(
      "launch-run",
      {
        campaignId: campaign.id,
        runId: run.id
      },
      {
        jobId: run.id,
        delay: Math.max(0, nextRunDate.getTime() - Date.now())
      }
    );
  }
}
