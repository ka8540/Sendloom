import { addMinutes } from "date-fns";
import { Prisma, type CampaignStatus } from "@prisma/client";

import { CAMPAIGN_SETUP_LOCKED_RUN_STATUSES, isCampaignSetupLocked } from "@/lib/campaign-setup-lock";
import { SCHEDULE_EDIT_DISABLED_MESSAGE, canEditCampaignSchedule } from "@/lib/campaign-schedule-edit";
import {
  planScheduledCampaignRun,
  SCHEDULABLE_CAMPAIGN_STATUSES
} from "@/lib/campaign-scheduling";
import { prisma } from "@/lib/db";
import { buildMergePayload } from "@/lib/mapping";
import { GMAIL_RECONNECT_ERROR, getUserSafeGmailSendError, isGmailReconnectError, sendEmail, type EmailAttachment } from "@/lib/provider";
import { consumeSendWindow, getSendWindowKey } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { getNextRunDate } from "@/lib/schedule";
import { renderTemplate, renderTemplateContent, type TemplateFormat } from "@/lib/templates";
import { makeTrackingUrl, shaKey } from "@/lib/tracking";
import type { CampaignValidationReport, ScheduleRule } from "@/lib/types";
import { buildValidationReport } from "@/lib/validation";
import { markSenderRequiresReconnect } from "@/services/senders";
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
  format?: TemplateFormat;
  htmlBody: string;
  variableManifest: unknown;
  attachments?: CampaignAttachmentSnapshot[];
};

type ProcessCampaignWorkArgs = {
  campaignId?: string;
  runId?: string;
  maxDurationMs?: number;
  maxRecipientJobsPerRun?: number;
  maxRuns?: number;
};

type ProcessCampaignRunResult = {
  processedJobs: number;
  hasRemainingWork: boolean;
  rateLimited: boolean;
  locked?: boolean;
};

type CampaignProcessingError = {
  scope: "scheduling" | "campaign-run";
  id?: string;
  message: string;
};

type QueueScheduledRunsResult = {
  campaignsScanned: number;
  runsCreated: number;
  dueCampaignsFound: number;
  lockSkipped: boolean;
  errors: CampaignProcessingError[];
};

type RecipientJobWithContext = Prisma.RecipientJobGetPayload<{
  include: {
    campaignRun: {
      include: {
        campaign: {
          include: {
            senderProfile: true;
          };
        };
      };
    };
  };
}>;

const RUN_LOCK_TTL_SECONDS = 55;
const RECIPIENT_LOCK_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_DURATION_MS = 45_000;
const DEFAULT_MAX_RUNS = 5;
const DEFAULT_MAX_RECIPIENT_JOBS_PER_RUN = 25;
const TERMINAL_RECIPIENT_STATUSES = new Set(["SENT", "SUPPRESSED", "INVALID", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED"]);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getDeadline(maxDurationMs = DEFAULT_MAX_DURATION_MS) {
  return Date.now() + maxDurationMs;
}

function hasTimeRemaining(deadline: number) {
  return Date.now() < deadline;
}

function appendTrackingMarkup(html: string, jobId: string, email: string) {
  const openUrl = makeTrackingUrl("open", jobId, email);
  return [html, `<img src="${openUrl}" alt="" width="1" height="1" style="display:none" />`].join("");
}

async function withRedisLock<T>(key: string, ttlSeconds: number, callback: () => Promise<T>) {
  const redis = getRedis();
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, "EX", ttlSeconds, "NX");

  if (acquired !== "OK") {
    return null;
  }

  try {
    return await callback();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token
    );
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function syncRunCounts(runId: string) {
  const [aggregate, replyAggregate] = await Promise.all([
    prisma.recipientJob.groupBy({
      by: ["status"],
      where: { campaignRunId: runId },
      _count: true
    }),
    prisma.recipientJob.aggregate({
      where: { campaignRunId: runId },
      _sum: {
        replyCount: true
      }
    })
  ]);

  const counts = Object.fromEntries(aggregate.map((entry) => [entry.status, entry._count]));

  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      sentCount: counts.SENT ?? 0,
      failedCount: counts.FAILED ?? 0,
      suppressedCount: counts.SUPPRESSED ?? 0,
      invalidCount: counts.INVALID ?? 0,
      openedCount: counts.OPENED ?? 0,
      clickedCount: counts.CLICKED ?? 0,
      repliedCount: replyAggregate._sum.replyCount ?? 0
    }
  });

  return counts;
}

async function finalizeRunIfComplete(runId: string) {
  const run = await prisma.campaignRun.findUnique({
    where: { id: runId },
    include: {
      campaign: {
        select: {
          id: true
        }
      }
    }
  });

  if (!run || !["RUNNING", "QUEUED"].includes(run.status)) {
    return false;
  }

  const pendingCount = await prisma.recipientJob.count({
    where: {
      campaignRunId: runId,
      status: {
        in: ["PENDING", "RETRYING"]
      }
    }
  });

  if (pendingCount > 0) {
    return false;
  }

  await syncRunCounts(runId);

  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      completedAt: run.completedAt ?? new Date()
    }
  });

  await prisma.campaign.update({
    where: { id: run.campaignId },
    data: {
      status: "COMPLETED"
    }
  });

  await ensureNextRecurringRun(run.campaignId);

  return true;
}

async function ensureRunIsStarted(runId: string) {
  await prisma.campaignRun.update({
    where: { id: runId },
    data: {
      status: "RUNNING",
      startedAt: new Date()
    }
  });
}

function isRetriableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate|timeout|temporar/i.test(message);
}

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
        format: (template.format as TemplateFormat | null) ?? "HTML",
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

export async function deleteCampaign(campaignId: string, userId?: string) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    select: {
      id: true
    }
  });

  await prisma.campaign.delete({
    where: { id: campaign.id }
  });

  return { id: campaign.id, deleted: true };
}

export async function updateCampaignAttachments(
  campaignId: string,
  attachments: CampaignAttachmentSnapshot[],
  userId?: string
) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    select: {
      id: true,
      templateSnapshot: true
    }
  });

  const currentSnapshot =
    campaign.templateSnapshot && typeof campaign.templateSnapshot === "object" && !Array.isArray(campaign.templateSnapshot)
      ? (campaign.templateSnapshot as CampaignTemplateSnapshot)
      : {
          subject: "",
          htmlBody: "",
          variableManifest: [],
          format: "HTML" as TemplateFormat
        };

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      templateSnapshot: {
        ...currentSnapshot,
        attachments
      } as Prisma.InputJsonValue
    }
  });

  return { id: campaign.id, attachments };
}

export async function updateCampaignSetup(
  input: {
    campaignId: string;
    name: string;
    importId: string;
    templateId: string;
    senderProfileId: string;
    attachments: CampaignAttachmentSnapshot[];
  },
  userId?: string
) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(input.campaignId, userId),
    select: {
      id: true,
      name: true,
      status: true,
      importId: true,
      templateId: true,
      senderProfileId: true,
      templateSnapshot: true,
      runs: {
        where: {
          status: {
            in: [...CAMPAIGN_SETUP_LOCKED_RUN_STATUSES]
          }
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true
        }
      }
    }
  });

  if (
    isCampaignSetupLocked({
      campaignStatus: campaign.status,
      latestRunStatus: campaign.runs[0]?.status ?? null
    })
  ) {
    throw new Error("Wait for the current run to finish before editing this sequence.");
  }

  const [importRecord, mapping, template, senderProfile] = await Promise.all([
    prisma.import.findFirstOrThrow({
      where: {
        id: input.importId,
        ...(userId ? { userId } : {})
      }
    }),
    prisma.mapping.findFirst({
      where: {
        importId: input.importId,
        ...(userId ? { userId } : {})
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.template.findFirstOrThrow({
      where: {
        id: input.templateId,
        ...(userId ? { userId } : {})
      }
    }),
    prisma.senderProfile.findFirstOrThrow({
      where: {
        id: input.senderProfileId,
        ...(userId ? { userId } : {})
      }
    })
  ]);

  if (!mapping) {
    throw new Error("Choose a contact list with template fields configured before saving.");
  }

  if (!senderProfile.oauthRefreshToken) {
    throw new Error(GMAIL_RECONNECT_ERROR);
  }

  const currentTemplateSnapshot =
    campaign.templateSnapshot && typeof campaign.templateSnapshot === "object" && !Array.isArray(campaign.templateSnapshot)
      ? (campaign.templateSnapshot as CampaignTemplateSnapshot)
      : {
          subject: "",
          htmlBody: "",
          variableManifest: [],
          format: "HTML" as TemplateFormat,
          attachments: []
        };

  const nextTemplateSnapshot: CampaignTemplateSnapshot = {
    ...currentTemplateSnapshot,
    subject: template.subject,
    format: (template.format as TemplateFormat | null) ?? "HTML",
    htmlBody: template.htmlBody,
    variableManifest: template.variableManifest,
    attachments: input.attachments
  };

  const structuralSetupChanged =
    campaign.importId !== importRecord.id ||
    campaign.templateId !== template.id ||
    campaign.senderProfileId !== senderProfile.id ||
    JSON.stringify(currentTemplateSnapshot.attachments ?? []) !== JSON.stringify(input.attachments);

  return prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      name: input.name,
      importId: importRecord.id,
      mappingId: mapping.id,
      templateId: template.id,
      senderProfileId: senderProfile.id,
      templateSnapshot: nextTemplateSnapshot as Prisma.InputJsonValue,
      mappingSnapshot: {
        reservedFieldMap: mapping.reservedFieldMap,
        variableMap: mapping.variableMap
      } as Prisma.InputJsonValue,
      senderSnapshot: {
        fromEmail: senderProfile.fromEmail,
        name: senderProfile.name
      } as Prisma.InputJsonValue,
      ...(structuralSetupChanged
        ? {
            status: "DRAFT" as const,
            lastValidatedAt: null,
            validationSnapshot: Prisma.JsonNull
          }
        : {})
    }
  });
}

export async function updateCampaignSchedule(
  input: {
    campaignId: string;
    scheduleRule: ScheduleRule;
  },
  userId?: string
) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(input.campaignId, userId),
    select: {
      id: true,
      importId: true,
      lastValidatedAt: true,
      status: true,
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          scheduledFor: true,
          startedAt: true,
          status: true,
          _count: {
            select: {
              recipientJobs: true
            }
          }
        }
      }
    }
  });

  const latestRun = campaign.runs[0] ?? null;
  if (
    !canEditCampaignSchedule({
      campaignStatus: campaign.status,
      latestRunRecipientJobCount: latestRun?._count.recipientJobs ?? 0,
      latestRunScheduledFor: latestRun?.scheduledFor ?? null,
      latestRunStartedAt: latestRun?.startedAt ?? null,
      latestRunStatus: latestRun?.status ?? null
    })
  ) {
    throw new Error(SCHEDULE_EDIT_DISABLED_MESSAGE);
  }

  if (input.scheduleRule.type === "once") {
    const scheduledFor = getNextRunDate(input.scheduleRule);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      throw new Error("Choose a future time for a one-time scheduled send.");
    }
  }

  const runToUpdate =
    latestRun &&
    ["QUEUED", "PAUSED"].includes(latestRun.status) &&
    !latestRun.startedAt &&
    latestRun._count.recipientJobs === 0
      ? latestRun
      : null;
  const nextScheduledFor = input.scheduleRule.type === "immediate" ? new Date() : getNextRunDate(input.scheduleRule);
  let nextCampaignStatus = campaign.status;

  if (runToUpdate?.status === "QUEUED") {
    nextCampaignStatus = input.scheduleRule.type === "immediate" ? "RUNNING" : "SCHEDULED";
  } else if (input.scheduleRule.type === "immediate" && campaign.status === "SCHEDULED") {
    nextCampaignStatus = campaign.lastValidatedAt ? "VALIDATED" : "DRAFT";
  } else if (!latestRun && input.scheduleRule.type !== "immediate") {
    nextCampaignStatus = "SCHEDULED";
  }

  return prisma.$transaction(async (tx) => {
    const updatedCampaign = await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        scheduleType: input.scheduleRule.type,
        scheduleConfig: input.scheduleRule as Prisma.InputJsonValue,
        status: nextCampaignStatus
      }
    });

    if (runToUpdate) {
      const updatedRun = await tx.campaignRun.update({
        where: { id: runToUpdate.id },
        data: {
          launchType: input.scheduleRule.type,
          scheduledFor: nextScheduledFor
        }
      });

      return { campaign: updatedCampaign, run: updatedRun };
    }

    if (!latestRun && (input.scheduleRule.type === "once" || input.scheduleRule.type === "recurring")) {
      const totalRecipients = await tx.importRow.count({
        where: {
          importId: campaign.importId
        }
      });
      const run = await tx.campaignRun.create({
        data: {
          campaignId: campaign.id,
          status: "QUEUED",
          launchType: input.scheduleRule.type,
          scheduledFor: nextScheduledFor,
          totalRecipients
        }
      });

      return { campaign: updatedCampaign, run };
    }

    return { campaign: updatedCampaign, run: null };
  });
}

export async function launchCampaign(campaignId: string, userId?: string) {
  const launchedRun = await withRedisLock(`sendloom:campaign-launch:${campaignId}`, RUN_LOCK_TTL_SECONDS, async () => {
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
      if (activeRun.status === "PAUSED") {
        const resumedRun = await prisma.campaignRun.update({
          where: { id: activeRun.id },
          data: {
            status: "QUEUED",
            scheduledFor: new Date()
          }
        });

        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            status: "RUNNING"
          }
        });

        return resumedRun;
      }

      return activeRun;
    }

    const rule = campaign.scheduleConfig as ScheduleRule;
    const scheduledFor = getNextRunDate(rule);
    const totalRecipients = campaign.import.rows.length;

    const run = await prisma.campaignRun.create({
      data: {
        campaignId,
        status: "QUEUED",
        launchType: rule.type,
        scheduledFor,
        totalRecipients
      }
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: rule.type === "immediate" ? "RUNNING" : "SCHEDULED"
      }
    });

    return run;
  });

  if (launchedRun) {
    return launchedRun;
  }

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

  throw new Error("This sequence launch is already being prepared. Try again in a moment.");
}

export async function pauseCampaign(campaignId: string, userId?: string) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    select: {
      id: true
    }
  });

  const activeRun = await prisma.campaignRun.findFirst({
    where: {
      campaignId,
      status: {
        in: ["QUEUED", "RUNNING"]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!activeRun) {
    return null;
  }

  const pausedRun = await prisma.campaignRun.update({
    where: { id: activeRun.id },
    data: {
      status: "PAUSED"
    }
  });

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: "PAUSED"
    }
  });

  return pausedRun;
}

export async function queueScheduledRuns() {
  const summary: QueueScheduledRunsResult = {
    campaignsScanned: 0,
    runsCreated: 0,
    dueCampaignsFound: 0,
    lockSkipped: false,
    errors: []
  };

  const lockResult = await withRedisLock("sendloom:scheduled-campaign-discovery", RUN_LOCK_TTL_SECONDS, async () => {
    const now = new Date();
    const scheduledCampaigns = await prisma.campaign.findMany({
      where: {
        scheduleType: {
          in: ["once", "recurring"]
        },
        status: {
          in: [...SCHEDULABLE_CAMPAIGN_STATUSES] as CampaignStatus[]
        },
        userId: {
          not: null
        },
        import: {
          status: "PROCESSED"
        },
        senderProfile: {
          oauthRefreshToken: {
            not: null
          }
        }
      },
      select: {
        id: true,
        status: true,
        scheduleType: true,
        scheduleConfig: true,
        runs: {
          orderBy: { createdAt: "desc" },
          select: {
            status: true,
            scheduledFor: true
          }
        }
      }
    });

    summary.campaignsScanned = scheduledCampaigns.length;

    for (const campaign of scheduledCampaigns) {
      const plan = planScheduledCampaignRun(
        {
          status: campaign.status,
          scheduleType: campaign.scheduleType,
          scheduleConfig: campaign.scheduleConfig as ScheduleRule | null,
          runs: campaign.runs
        },
        now
      );

      if (plan.due) {
        summary.dueCampaignsFound += 1;
      }

      if (plan.action !== "create-run") {
        continue;
      }

      try {
        const createdRun = await createScheduledRunIfNeeded(campaign.id, now);
        if (createdRun) {
          summary.runsCreated += 1;
        }
      } catch (error) {
        console.error("[campaign-scheduler] Failed to schedule campaign run.", {
          campaignId: campaign.id,
          error
        });
        summary.errors.push({
          scope: "scheduling",
          id: campaign.id,
          message: getErrorMessage(error)
        });
      }
    }

    return summary;
  });

  if (!lockResult) {
    return {
      ...summary,
      lockSkipped: true
    };
  }

  return lockResult;
}

export const queueRecurringRuns = queueScheduledRuns;

async function createScheduledRunIfNeeded(campaignId: string, now = new Date()) {
  return withRedisLock(`sendloom:campaign-launch:${campaignId}`, RUN_LOCK_TTL_SECONDS, async () =>
    prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          userId: true,
          status: true,
          scheduleType: true,
          scheduleConfig: true,
          importId: true,
          import: {
            select: {
              status: true
            }
          },
          senderProfile: {
            select: {
              oauthRefreshToken: true
            }
          },
          runs: {
            orderBy: { createdAt: "desc" },
            select: {
              status: true,
              scheduledFor: true
            }
          }
        }
      });

      if (!campaign || !campaign.userId || campaign.import.status !== "PROCESSED" || !campaign.senderProfile.oauthRefreshToken) {
        return null;
      }

      const plan = planScheduledCampaignRun(
        {
          status: campaign.status,
          scheduleType: campaign.scheduleType,
          scheduleConfig: campaign.scheduleConfig as ScheduleRule | null,
          runs: campaign.runs
        },
        now
      );

      if (plan.action !== "create-run") {
        return null;
      }

      const totalRecipients = await tx.importRow.count({
        where: {
          importId: campaign.importId
        }
      });

      const run = await tx.campaignRun.create({
        data: {
          campaignId,
          status: "QUEUED",
          launchType: plan.launchType,
          scheduledFor: plan.scheduledFor,
          totalRecipients
        }
      });

      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          status: "SCHEDULED"
        }
      });

      return run;
    })
  );
}

async function ensureNextRecurringRun(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      scheduleType: true
    }
  });

  if (campaign?.scheduleType !== "recurring") {
    return null;
  }

  return createScheduledRunIfNeeded(campaignId);
}

async function createRecipientJobIgnoringDuplicate(data: Prisma.RecipientJobUncheckedCreateInput) {
  try {
    return await prisma.recipientJob.create({
      data
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null;
    }

    throw error;
  }
}

async function ensureRecipientJobs(campaignId: string, runId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      import: { include: { rows: true } }
    }
  });

  const existingImportRowIds = new Set(
    (
      await prisma.recipientJob.findMany({
        where: { campaignRunId: runId },
        select: { importRowId: true }
      })
    ).map((job) => job.importRowId)
  );

  const suppressedEmails = await getSuppressedEmailsForUser(campaign.userId);
  const templateSnapshot = campaign.templateSnapshot as CampaignTemplateSnapshot;
  const subjectTemplate = templateSnapshot.subject;
  const templateFormat = templateSnapshot.format ?? "HTML";
  const htmlTemplate = templateSnapshot.htmlBody;
  const mappingSnapshot = campaign.mappingSnapshot as {
    reservedFieldMap?: Record<string, string>;
    variableMap?: Record<string, string>;
  };

  for (const row of campaign.import.rows) {
    if (existingImportRowIds.has(row.id)) {
      continue;
    }

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
      await createRecipientJobIgnoringDuplicate({
        campaignRunId: runId,
        importRowId: row.id,
        recipientEmail: email,
        recipientName: typeof payload.name === "string" ? payload.name : null,
        subject: renderTemplate(subjectTemplate, payload),
        htmlBody: renderTemplateContent(templateFormat, htmlTemplate, payload),
        dedupeKey: shaKey([runId, email]),
        status: "SUPPRESSED",
        metadata: metadata as Prisma.InputJsonValue
      });
      continue;
    }

    const subject = renderTemplate(subjectTemplate, payload);
    const renderedHtml = renderTemplateContent(templateFormat, htmlTemplate, payload);

    const jobRecord = await createRecipientJobIgnoringDuplicate({
      campaignRunId: runId,
      importRowId: row.id,
      recipientEmail: email,
      recipientName: typeof payload.name === "string" ? payload.name : null,
      subject,
      htmlBody: renderedHtml,
      dedupeKey: shaKey([runId, email]),
      metadata: metadata as Prisma.InputJsonValue
    });

    if (jobRecord) {
      await prisma.recipientJob.update({
        where: { id: jobRecord.id },
        data: {
          htmlBody: appendTrackingMarkup(renderedHtml, jobRecord.id, email)
        }
      });
    }
  }

  await syncRunCounts(runId);
}

export const enqueueRecipientJobs = ensureRecipientJobs;

async function failQueuedRecipientJobs(runId: string, message: string, skipJobId?: string) {
  await prisma.recipientJob.updateMany({
    where: {
      campaignRunId: runId,
      ...(skipJobId ? { id: { not: skipJobId } } : {}),
      status: {
        in: ["PENDING", "RETRYING"]
      }
    },
    data: {
      status: "FAILED",
      lastError: message,
      nextRetryAt: null
    }
  });

  await syncRunCounts(runId);
}

async function processRecipientJob(recipientJob: RecipientJobWithContext) {
  const outcome = await withRedisLock(`sendloom:recipient-job:${recipientJob.id}`, RECIPIENT_LOCK_TTL_SECONDS, async () => {
    const latestJob = await prisma.recipientJob.findUnique({
      where: { id: recipientJob.id },
      include: {
        campaignRun: {
          include: {
            campaign: {
              include: {
                senderProfile: true
              }
            }
          }
        }
      }
    });

    if (!latestJob || TERMINAL_RECIPIENT_STATUSES.has(latestJob.status)) {
      return {
        processed: false,
        rateLimited: false
      };
    }

    if (latestJob.status === "RETRYING" && latestJob.nextRetryAt && latestJob.nextRetryAt > new Date()) {
      return {
        processed: false,
        rateLimited: false
      };
    }

    try {
      const rateWindow = await consumeSendWindow(
        getSendWindowKey({
          userId: latestJob.campaignRun.campaign.userId ?? latestJob.campaignRun.campaign.senderProfile.userId,
          senderProfileId: latestJob.campaignRun.campaign.senderProfileId
        })
      );
      if (!rateWindow.allowed) {
        await markRecipientAttempt({
          jobId: latestJob.id,
          status: "RETRYING",
          lastError: "Rate limit window reached"
        });

        return {
          processed: true,
          rateLimited: true
        };
      }

      const sender = latestJob.campaignRun.campaign.senderSnapshot as {
        fromEmail: string;
        name: string;
      };
      const templateSnapshot = latestJob.campaignRun.campaign.templateSnapshot as {
        attachments?: EmailAttachment[];
      };
      const response = await sendEmail({
        from: `${sender.name} <${sender.fromEmail}>`,
        to: latestJob.recipientEmail,
        subject: latestJob.subject,
        html: latestJob.htmlBody,
        attachments: templateSnapshot.attachments ?? [],
        sender: {
          fromEmail: latestJob.campaignRun.campaign.senderProfile.fromEmail,
          oauthRefreshToken: latestJob.campaignRun.campaign.senderProfile.oauthRefreshToken
        }
      });

      await markRecipientAttempt({
        jobId: latestJob.id,
        status: "SENT",
        providerMessageId: response.data?.id
      });

      return {
        processed: true,
        rateLimited: false
      };
    } catch (error) {
      const message = getUserSafeGmailSendError(error);

      if (isGmailReconnectError(error)) {
        await markSenderRequiresReconnect(latestJob.campaignRun.campaign.senderProfile.id);

        await markRecipientAttempt({
          jobId: latestJob.id,
          status: "FAILED",
          lastError: GMAIL_RECONNECT_ERROR
        });

        await failQueuedRecipientJobs(latestJob.campaignRunId, GMAIL_RECONNECT_ERROR, latestJob.id);

        return {
          processed: true,
          rateLimited: false
        };
      }

      console.error("[campaign-send] Delivery failed.", error);

      if (latestJob.retryCount < 5 && isRetriableError(error)) {
        await markRecipientAttempt({
          jobId: latestJob.id,
          status: "RETRYING",
          lastError: message
        });

        return {
          processed: true,
          rateLimited: false
        };
      }

      await markRecipientAttempt({
        jobId: latestJob.id,
        status: "FAILED",
        lastError: message
      });

      return {
        processed: true,
        rateLimited: false
      };
    }
  });

  return outcome ?? {
    processed: false,
    rateLimited: false
  };
}

export async function processCampaignRun(
  runId: string,
  args: {
    maxDurationMs?: number;
    maxRecipientJobs?: number;
  } = {}
): Promise<ProcessCampaignRunResult> {
  const lockResult = await withRedisLock(`sendloom:campaign-run:${runId}`, RUN_LOCK_TTL_SECONDS, async () => {
    const deadline = getDeadline(args.maxDurationMs);
    const maxRecipientJobs = args.maxRecipientJobs ?? DEFAULT_MAX_RECIPIENT_JOBS_PER_RUN;

    const run = await prisma.campaignRun.findUnique({
      where: { id: runId },
      include: {
        campaign: {
          include: {
            senderProfile: true
          }
        }
      }
    });

    if (!run || !["QUEUED", "RUNNING"].includes(run.status)) {
      return {
        processedJobs: 0,
        hasRemainingWork: false,
        rateLimited: false
      };
    }

    const isDue = !run.scheduledFor || run.scheduledFor <= new Date();
    if (!isDue) {
      return {
        processedJobs: 0,
        hasRemainingWork: true,
        rateLimited: false
      };
    }

    if (run.status === "QUEUED") {
      await ensureRunIsStarted(run.id);
      await prisma.campaign.update({
        where: { id: run.campaignId },
        data: {
          status: "RUNNING"
        }
      });
    }

    await ensureRecipientJobs(run.campaignId, run.id);

    const candidateJobs = await prisma.recipientJob.findMany({
      where: {
        campaignRunId: run.id,
        OR: [
          {
            status: "PENDING"
          },
          {
            status: "RETRYING",
            nextRetryAt: {
              lte: new Date()
            }
          }
        ]
      },
      include: {
        campaignRun: {
          include: {
            campaign: {
              include: {
                senderProfile: true
              }
            }
          }
        }
      },
      orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
      take: maxRecipientJobs
    });

    let processedJobs = 0;
    let rateLimited = false;

    for (const recipientJob of candidateJobs) {
      if (!hasTimeRemaining(deadline)) {
        break;
      }

      const result = await processRecipientJob(recipientJob);
      if (result.processed) {
        processedJobs += 1;
      }
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
    }

    await finalizeRunIfComplete(run.id);

    const remainingJobs = await prisma.recipientJob.count({
      where: {
        campaignRunId: run.id,
        status: {
          in: ["PENDING", "RETRYING"]
        }
      }
    });

    return {
      processedJobs,
      hasRemainingWork: remainingJobs > 0,
      rateLimited
    };
  });

  return (
    lockResult ?? {
      processedJobs: 0,
      hasRemainingWork: true,
      rateLimited: false,
      locked: true
    }
  );
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
      lastError: args.status === "SENT" ? null : args.lastError ?? null,
      retryCount: args.status === "RETRYING" ? { increment: 1 } : undefined,
      nextRetryAt: args.status === "RETRYING" ? addMinutes(new Date(), 5) : null
    }
  });

  await syncRunCounts(updated.campaignRunId);

  return updated;
}

export async function pauseCampaignRunForSenderLimit(args: {
  runId: string;
  jobId?: string;
  message: string;
}) {
  await prisma.$transaction(async (tx) => {
    if (args.jobId) {
      await tx.recipientJob.update({
        where: { id: args.jobId },
        data: {
          status: "FAILED",
          lastError: args.message,
          nextRetryAt: null
        }
      });
    }

    const run = await tx.campaignRun.update({
      where: { id: args.runId },
      data: {
        status: "PAUSED"
      },
      select: {
        campaignId: true
      }
    });

    await tx.campaign.update({
      where: { id: run.campaignId },
      data: {
        status: "PAUSED"
      }
    });
  });

  await syncRunCounts(args.runId);
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
    const updated = await prisma.recipientJob.update({
      where: { id: recipientJob.id },
      data: {
        status: args.eventType === "CLICKED" ? "CLICKED" : "OPENED"
      }
    });

    await syncRunCounts(recipientJob.campaignRunId);
    return updated;
  }

  return recipientJob;
}

export async function processPendingCampaignWork(args: ProcessCampaignWorkArgs = {}) {
  const scheduling: QueueScheduledRunsResult = {
    campaignsScanned: 0,
    runsCreated: 0,
    dueCampaignsFound: 0,
    lockSkipped: false,
    errors: []
  };

  try {
    Object.assign(scheduling, await queueScheduledRuns());
  } catch (error) {
    console.error("[campaign-cron] Scheduled campaign discovery failed.", error);
    scheduling.errors.push({
      scope: "scheduling",
      message: getErrorMessage(error)
    });
  }

  const deadline = getDeadline(args.maxDurationMs);
  const maxRuns = args.maxRuns ?? DEFAULT_MAX_RUNS;
  const maxRecipientJobsPerRun = args.maxRecipientJobsPerRun ?? DEFAULT_MAX_RECIPIENT_JOBS_PER_RUN;
  const errors: CampaignProcessingError[] = [...scheduling.errors];
  const dueRunWhere: Prisma.CampaignRunWhereInput = {
    ...(args.runId ? { id: args.runId } : {}),
    ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    campaign: {
      userId: {
        not: null
      },
      status: {
        notIn: ["PAUSED", "CANCELLED", "FAILED"]
      },
      import: {
        status: "PROCESSED"
      },
      senderProfile: {
        oauthRefreshToken: {
          not: null
        }
      }
    },
    OR: [
      {
        status: "RUNNING"
      },
      {
        status: "QUEUED",
        scheduledFor: {
          lte: new Date()
        }
      },
      {
        status: "QUEUED",
        scheduledFor: null
      }
    ]
  };

  let runsProcessed = 0;
  let recipientJobsProcessed = 0;
  let hasRemainingWork = false;
  let dueCampaignsFound = scheduling.dueCampaignsFound;

  try {
    const dueCampaigns = await prisma.campaignRun.findMany({
      where: dueRunWhere,
      select: {
        campaignId: true
      },
      distinct: ["campaignId"]
    });

    dueCampaignsFound = dueCampaigns.length;
  } catch (error) {
    console.error("[campaign-cron] Failed to count due campaigns.", error);
    errors.push({
      scope: "scheduling",
      message: getErrorMessage(error)
    });
  }

  while (hasTimeRemaining(deadline) && runsProcessed < maxRuns) {
    const runs = await prisma.campaignRun.findMany({
      where: dueRunWhere,
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: maxRuns
    });

    if (!runs.length) {
      break;
    }

    let progressedThisPass = false;

    for (const run of runs) {
      if (!hasTimeRemaining(deadline) || runsProcessed >= maxRuns) {
        break;
      }

      try {
        const result = await processCampaignRun(run.id, {
          maxDurationMs: Math.max(1_000, deadline - Date.now()),
          maxRecipientJobs: maxRecipientJobsPerRun
        });

        if (!result.locked) {
          runsProcessed += 1;
        }
        recipientJobsProcessed += result.processedJobs;
        hasRemainingWork = hasRemainingWork || result.hasRemainingWork;
        progressedThisPass =
          progressedThisPass || result.processedJobs > 0 || (!result.locked && !result.hasRemainingWork);

        if (result.rateLimited) {
          hasRemainingWork = true;
          break;
        }
      } catch (error) {
        console.error("[campaign-cron] Failed to process campaign run.", {
          runId: run.id,
          error
        });
        errors.push({
          scope: "campaign-run",
          id: run.id,
          message: getErrorMessage(error)
        });
      }
    }

    if (!progressedThisPass) {
      break;
    }
  }

  const remainingRuns = await prisma.campaignRun.count({
    where: dueRunWhere
  });

  return {
    dueCampaignsFound,
    runsCreated: scheduling.runsCreated,
    scheduledCampaignsScanned: scheduling.campaignsScanned,
    schedulingLockSkipped: scheduling.lockSkipped,
    runsProcessed,
    recipientJobsProcessed,
    hasRemainingWork: hasRemainingWork || remainingRuns > 0,
    errors
  };
}
