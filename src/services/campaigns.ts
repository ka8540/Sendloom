import { Prisma, type CampaignStatus } from "@prisma/client";

import { CAMPAIGN_SETUP_LOCKED_RUN_STATUSES, isCampaignSetupLocked } from "@/lib/campaign-setup-lock";
import { SCHEDULE_EDIT_DISABLED_MESSAGE, canEditCampaignSchedule } from "@/lib/campaign-schedule-edit";
import {
  planScheduledCampaignRun,
  SCHEDULABLE_CAMPAIGN_STATUSES
} from "@/lib/campaign-scheduling";
import { prisma } from "@/lib/db";
import type { FailureCode, FailureSource } from "@/lib/failures";
import {
  MAX_FOLLOW_UP_ATTEMPTS,
  toReplySubject,
  validateFollowUpConfig,
  type FollowUpConfigInput,
  type FollowUpSendMode,
  type FollowUpTemplateSnapshot
} from "@/lib/follow-up";
import { buildMergePayload } from "@/lib/mapping";
import { GMAIL_RECONNECT_ERROR, getUserSafeGmailSendError, isGmailReconnectError, sendEmail, type EmailAttachment } from "@/lib/provider";
import { consumeSendWindow, getSendWindowKey } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { classifySendFailure, getNextRetryAt, isRetryableFailure, MAX_RETRY_ATTEMPTS } from "@/lib/retry-policy";
import { getNextRunDate, normalizeScheduleRule } from "@/lib/schedule";
import { getSystemHealth } from "@/lib/system-health";
import { extractTemplateVariables, renderTemplate, renderTemplateContent, type TemplateFormat } from "@/lib/templates";
import { makeTrackingUrl, shaKey } from "@/lib/tracking";
import type { CampaignValidationReport, ScheduleRule } from "@/lib/types";
import {
  buildStructuredValidationChecks,
  buildValidationReport,
  getLaunchBlockingValidationMessage,
  getUnresolvedTemplateVariables,
  withStructuredValidationChecks
} from "@/lib/validation";
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

async function getSuppressionReasonsForUser(userId: string | null) {
  if (!userId) {
    return new Map<string, string>();
  }

  const suppressions = await prisma.suppression.findMany({
    where: {
      userId
    },
    select: {
      email: true,
      reason: true
    }
  });

  return new Map(suppressions.map((entry) => [entry.email, entry.reason]));
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

  // The sequence is only "complete" once any pending follow-ups have also resolved.
  const pendingFollowUps = await prisma.recipientJob.count({
    where: {
      campaignRun: { campaignId: run.campaignId },
      followUpStatus: "PENDING"
    }
  });

  await prisma.campaign.update({
    where: { id: run.campaignId },
    data: {
      status: pendingFollowUps > 0 ? "RUNNING" : "COMPLETED"
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

export function hasLaunchBlockingValidationIssues(report: CampaignValidationReport) {
  return Boolean(report.summary && (report.summary.blockers > 0 || report.summary.errors > 0));
}

export class CampaignLaunchBlockedError extends Error {
  report: CampaignValidationReport;

  constructor(report: CampaignValidationReport) {
    super(getLaunchBlockingValidationMessage(report));
    this.name = "CampaignLaunchBlockedError";
    this.report = report;
  }
}

type FollowUpCampaignData = {
  followUpEnabled: boolean;
  followUpTemplateId: string | null;
  followUpSendMode: string | null;
  followUpScheduledAt: Date | null;
  followUpTimezone: string | null;
  followUpTemplateSnapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

/**
 * Validate a follow-up config and resolve a Campaign-shaped data object,
 * snapshotting the chosen follow-up template so later edits don't change
 * what already-launched recipients receive.
 */
async function buildFollowUpCampaignData(
  followUp: FollowUpConfigInput | undefined,
  userId: string
): Promise<FollowUpCampaignData> {
  if (!followUp?.enabled) {
    return {
      followUpEnabled: false,
      followUpTemplateId: null,
      followUpSendMode: null,
      followUpScheduledAt: null,
      followUpTimezone: null,
      followUpTemplateSnapshot: Prisma.JsonNull
    };
  }

  const validation = validateFollowUpConfig(followUp);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const template = await prisma.template.findFirst({
    where: {
      id: followUp.templateId ?? "",
      userId
    }
  });

  if (!template) {
    throw new Error("Choose a follow-up template connected to your account.");
  }

  const snapshot: FollowUpTemplateSnapshot = {
    subject: template.subject,
    format: (template.format as string | null) ?? "HTML",
    htmlBody: template.htmlBody,
    variableManifest: template.variableManifest
  };

  return {
    followUpEnabled: true,
    followUpTemplateId: template.id,
    followUpSendMode: followUp.sendMode,
    followUpScheduledAt: new Date(followUp.scheduledAt ?? ""),
    followUpTimezone: followUp.timezone ?? null,
    followUpTemplateSnapshot: snapshot as Prisma.InputJsonValue
  };
}

export async function createCampaignDraft(input: {
  name: string;
  importId: string;
  mappingId: string;
  templateId: string;
  senderProfileId: string;
  scheduleRule: ScheduleRule;
  attachments?: CampaignAttachmentSnapshot[];
  followUp?: FollowUpConfigInput;
}, userId: string) {
  const scheduleRule = normalizeScheduleRule(input.scheduleRule);
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

  const followUpData = await buildFollowUpCampaignData(input.followUp, userId);

  return prisma.campaign.create({
    data: {
      userId,
      name: input.name,
      importId: importRecord.id,
      mappingId: mapping.id,
      templateId: input.templateId,
      senderProfileId: input.senderProfileId,
      scheduleType: input.scheduleRule.type,
      scheduleConfig: scheduleRule,
      ...followUpData,
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
      senderProfile: true,
      mapping: true,
      template: true,
      import: {
        include: {
          columns: true,
          rows: true
        }
      }
    }
  });

  const [suppressedEmails, suppressionReasons, systemHealth] = await Promise.all([
    getSuppressedEmailsForUser(campaign.userId),
    getSuppressionReasonsForUser(campaign.userId),
    getSystemHealth()
  ]);
  const templateSnapshot = campaign.templateSnapshot as CampaignTemplateSnapshot;
  const mappingSnapshot = campaign.mappingSnapshot as {
    reservedFieldMap?: Record<string, string>;
    variableMap?: Record<string, string>;
  };
  const rows = campaign.import.rows.map((row) => {
    const payload = buildMergePayload(row.normalized as Record<string, unknown>, mappingSnapshot);

    return {
      rowIndex: row.rowIndex,
      email: typeof payload.email === "string" ? payload.email : row.email,
      payload,
      normalized: row.normalized as Record<string, unknown>
    };
  });
  const baseReport = buildValidationReport({
    rows,
    templateSubject: templateSnapshot.subject,
    templateHtml: templateSnapshot.htmlBody,
    suppressedEmails
  });
  const checks = await buildStructuredValidationChecks({
    campaignId,
    userId: campaign.userId,
    senderProfile: campaign.senderProfile,
    importRecord: {
      rowCount: campaign.import.rowCount,
      rows: rows.map((row) => ({
        rowIndex: row.rowIndex,
        email: row.email,
        normalized: row.normalized
      })),
      columns: campaign.import.columns
    },
    mappingRecord: campaign.mapping,
    templateRecord: campaign.template,
    templateSnapshot,
    mappingSnapshot,
    scheduleType: campaign.scheduleType,
    scheduleConfig: campaign.scheduleConfig,
    suppressionReasons,
    report: baseReport,
    systemHealth
  });
  const report = withStructuredValidationChecks(baseReport, checks);

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

async function ensureCampaignLaunchable(campaignId: string, userId?: string) {
  const report = await validateCampaign(campaignId, userId);
  if (hasLaunchBlockingValidationIssues(report)) {
    throw new CampaignLaunchBlockedError(report);
  }

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
    followUp?: FollowUpConfigInput;
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
      followUpEnabled: true,
      followUpTemplateId: true,
      followUpSendMode: true,
      followUpScheduledAt: true,
      followUpTimezone: true,
      followUpTemplateSnapshot: true,
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

  let followUpData: FollowUpCampaignData | null = null;
  if (input.followUp) {
    const [processedFollowUps, pendingFollowUps] = await Promise.all([
      prisma.recipientJob.count({
        where: {
          campaignRun: { campaignId: campaign.id },
          followUpStatus: { in: ["SENT", "FAILED", "SKIPPED"] }
        }
      }),
      prisma.recipientJob.count({
        where: {
          campaignRun: { campaignId: campaign.id },
          followUpStatus: "PENDING"
        }
      })
    ]);

    if (processedFollowUps > 0) {
      const followUpDetailsChanged =
        input.followUp.enabled !== campaign.followUpEnabled ||
        (input.followUp.templateId ?? null) !== campaign.followUpTemplateId ||
        (input.followUp.sendMode ?? null) !== campaign.followUpSendMode;

      if (followUpDetailsChanged) {
        throw new Error(
          "Follow-up template, delivery mode, and enablement cannot be changed after sending starts. You can still reschedule pending follow-ups."
        );
      }

      if (pendingFollowUps === 0) {
        throw new Error("No pending follow-up emails remain to reschedule.");
      }

      const validation = validateFollowUpConfig(input.followUp);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      followUpData = {
        followUpEnabled: campaign.followUpEnabled,
        followUpTemplateId: campaign.followUpTemplateId,
        followUpSendMode: campaign.followUpSendMode,
        followUpScheduledAt: new Date(input.followUp.scheduledAt ?? ""),
        followUpTimezone: input.followUp.timezone ?? campaign.followUpTimezone,
        followUpTemplateSnapshot:
          campaign.followUpTemplateSnapshot === null
            ? Prisma.JsonNull
            : (campaign.followUpTemplateSnapshot as Prisma.InputJsonValue)
      };
    } else {
      followUpData = await buildFollowUpCampaignData(input.followUp, userId ?? "");
    }
  }

  const updatedCampaign = await prisma.campaign.update({
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
      ...(followUpData ?? {}),
      ...(structuralSetupChanged
        ? {
            status: "DRAFT" as const,
            lastValidatedAt: null,
            validationSnapshot: Prisma.JsonNull
          }
        : {})
    }
  });

  // When follow-up is toggled, reconcile already-delivered recipients so the
  // scheduler sees the right set of owed follow-ups.
  if (followUpData) {
    const runs = await prisma.campaignRun.findMany({
      where: { campaignId: campaign.id },
      select: { id: true }
    });
    const runIds = runs.map((run) => run.id);

    if (runIds.length > 0) {
      if (followUpData.followUpEnabled) {
        // Enabling: owe a follow-up to every recipient already delivered.
        await prisma.recipientJob.updateMany({
          where: {
            campaignRunId: { in: runIds },
            status: { in: ["SENT", "OPENED", "CLICKED"] },
            followUpStatus: null
          },
          data: { followUpStatus: "PENDING" }
        });
      } else {
        // Disabling: cancel follow-ups that have not been sent yet.
        await prisma.recipientJob.updateMany({
          where: {
            campaignRunId: { in: runIds },
            followUpStatus: "PENDING"
          },
          data: { followUpStatus: null }
        });
      }
    }
  }

  return updatedCampaign;
}

export async function updateCampaignSchedule(
  input: {
    campaignId: string;
    scheduleRule: ScheduleRule;
  },
  userId?: string
) {
  const scheduleRule = normalizeScheduleRule(input.scheduleRule);
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

  if (scheduleRule.type === "once") {
    const scheduledFor = getNextRunDate(scheduleRule);
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
  const nextScheduledFor = scheduleRule.type === "immediate" ? new Date() : getNextRunDate(scheduleRule);
  let nextCampaignStatus = campaign.status;

  if (runToUpdate?.status === "QUEUED") {
    nextCampaignStatus = scheduleRule.type === "immediate" ? "RUNNING" : "SCHEDULED";
  } else if (scheduleRule.type === "immediate" && campaign.status === "SCHEDULED") {
    nextCampaignStatus = campaign.lastValidatedAt ? "VALIDATED" : "DRAFT";
  } else if (!latestRun && scheduleRule.type !== "immediate") {
    nextCampaignStatus = "SCHEDULED";
  }

  return prisma.$transaction(async (tx) => {
    const updatedCampaign = await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        scheduleType: scheduleRule.type,
        scheduleConfig: scheduleRule as Prisma.InputJsonValue,
        status: nextCampaignStatus
      }
    });

    if (runToUpdate) {
      const updatedRun = await tx.campaignRun.update({
        where: { id: runToUpdate.id },
        data: {
          launchType: scheduleRule.type,
          scheduledFor: nextScheduledFor
        }
      });

      return { campaign: updatedCampaign, run: updatedRun };
    }

    if (!latestRun && (scheduleRule.type === "once" || scheduleRule.type === "recurring")) {
      const totalRecipients = await tx.importRow.count({
        where: {
          importId: campaign.importId
        }
      });
      const run = await tx.campaignRun.create({
        data: {
          campaignId: campaign.id,
          status: "QUEUED",
          launchType: scheduleRule.type,
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
  const existingActiveRun = await prisma.campaignRun.findFirst({
    where: {
      campaignId,
      ...(userId
        ? {
            campaign: {
              userId
            }
          }
        : {}),
      status: {
        in: ["QUEUED", "RUNNING"]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!existingActiveRun) {
    await ensureCampaignLaunchable(campaignId, userId);
  }

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
    // No active run, but pending follow-ups can still be paused.
    const pendingFollowUps = await prisma.recipientJob.count({
      where: {
        campaignRun: { campaignId },
        followUpStatus: "PENDING"
      }
    });

    if (pendingFollowUps > 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "PAUSED" }
      });
    }

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

/**
 * Resume a PAUSED campaign, respecting the schedule type:
 * - immediate: queue immediately (scheduledFor = now)
 * - once:      restore original scheduled time if still in the future, else queue now
 * - recurring: advance to the next occurrence (getNextRunDate), status = SCHEDULED
 *
 * Unlike launchCampaign's PAUSED branch (which always sets scheduledFor = now),
 * this prevents recurring/scheduled sequences from sending immediately on resume.
 */
export async function resumeCampaign(campaignId: string, userId?: string) {
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: campaignOwnershipFilter(campaignId, userId),
    select: {
      id: true,
      status: true,
      scheduleType: true,
      scheduleConfig: true
    }
  });

  const pausedRun = await prisma.campaignRun.findFirst({
    where: {
      campaignId,
      status: "PAUSED"
    },
    orderBy: { createdAt: "desc" }
  });

  if (!pausedRun) {
    // No paused run, but a follow-up-only sequence can still be resumed.
    const pendingFollowUps = await prisma.recipientJob.count({
      where: {
        campaignRun: { campaignId },
        followUpStatus: "PENDING"
      }
    });

    if (campaign.status === "PAUSED" && pendingFollowUps > 0) {
      // Back to RUNNING so the follow-up scheduler picks it up again on schedule.
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "RUNNING" }
      });
    }

    return null;
  }

  const rule = campaign.scheduleConfig as ScheduleRule;
  const now = new Date();

  let scheduledFor: Date;
  let nextCampaignStatus: "RUNNING" | "SCHEDULED";

  if (campaign.scheduleType === "recurring") {
    // Always advance to the next scheduled occurrence — never send immediately.
    scheduledFor = getNextRunDate(rule, now);
    nextCampaignStatus = "SCHEDULED";
  } else if (campaign.scheduleType === "once") {
    // Use the configured scheduled time if it's still in the future.
    const configuredTime = getNextRunDate(rule, now);
    const isFuture = !Number.isNaN(configuredTime.getTime()) && configuredTime > now;
    scheduledFor = isFuture ? configuredTime : now;
    nextCampaignStatus = isFuture ? "SCHEDULED" : "RUNNING";
  } else {
    // immediate: queue now, process ASAP.
    scheduledFor = now;
    nextCampaignStatus = "RUNNING";
  }

  const resumedRun = await prisma.campaignRun.update({
    where: { id: pausedRun.id },
    data: {
      status: "QUEUED",
      scheduledFor
    }
  });

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: nextCampaignStatus }
  });

  return resumedRun;
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
  const templateVariables = Array.from(
    new Set([...extractTemplateVariables(subjectTemplate), ...extractTemplateVariables(htmlTemplate)])
  );
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

    const unresolvedVariables = getUnresolvedTemplateVariables(templateVariables, payload);
    if (unresolvedVariables.length > 0) {
      await createRecipientJobIgnoringDuplicate({
        campaignRunId: runId,
        importRowId: row.id,
        recipientEmail: email,
        recipientName: typeof payload.name === "string" ? payload.name : null,
        subject: renderTemplate(subjectTemplate, payload),
        htmlBody: renderTemplateContent(templateFormat, htmlTemplate, payload),
        dedupeKey: shaKey([runId, email]),
        status: "INVALID",
        lastError: `Missing template variable value${unresolvedVariables.length === 1 ? "" : "s"}: ${unresolvedVariables.join(", ")}`,
        metadata: {
          ...metadata,
          failureCode: "UNRESOLVED_TEMPLATE_VARIABLE",
          failureSource: "TEMPLATE",
          unresolvedVariables
        } as Prisma.InputJsonValue
      });
      continue;
    }

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
          lastError: "Rate limit window reached",
          failureCode: "GMAIL_RATE_LIMITED",
          failureSource: "GMAIL"
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
      // Set our own Message-ID so same-thread follow-ups can reference it.
      const senderDomain = latestJob.campaignRun.campaign.senderProfile.fromEmail.split("@")[1] || "sendloom.app";
      const initialMessageIdHeader = `<sl-${latestJob.id}-${Date.now()}@${senderDomain}>`;
      const response = await sendEmail({
        from: `${sender.name} <${sender.fromEmail}>`,
        to: latestJob.recipientEmail,
        subject: latestJob.subject,
        html: latestJob.htmlBody,
        attachments: templateSnapshot.attachments ?? [],
        messageId: initialMessageIdHeader,
        sender: {
          fromEmail: latestJob.campaignRun.campaign.senderProfile.fromEmail,
          oauthRefreshToken: latestJob.campaignRun.campaign.senderProfile.oauthRefreshToken
        }
      });

      await markRecipientAttempt({
        jobId: latestJob.id,
        status: "SENT",
        providerMessageId: response.data?.id,
        gmailThreadId: response.data?.threadId ?? undefined,
        initialMessageIdHeader,
        followUpStatus: latestJob.campaignRun.campaign.followUpEnabled ? "PENDING" : undefined
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
          lastError: GMAIL_RECONNECT_ERROR,
          failureCode: "GMAIL_PROFILE_DISCONNECTED",
          failureSource: "GMAIL"
        });

        await failQueuedRecipientJobs(latestJob.campaignRunId, GMAIL_RECONNECT_ERROR, latestJob.id);

        return {
          processed: true,
          rateLimited: false
        };
      }

      console.error("[campaign-send] Delivery failed.", error);

      const failureCode = classifySendFailure(error, {
        senderConnected: Boolean(latestJob.campaignRun.campaign.senderProfile.oauthRefreshToken)
      });

      if (latestJob.retryCount < MAX_RETRY_ATTEMPTS && isRetryableFailure(failureCode)) {
        await markRecipientAttempt({
          jobId: latestJob.id,
          status: "RETRYING",
          lastError: message,
          failureCode,
          failureSource: "GMAIL"
        });

        return {
          processed: true,
          rateLimited: false
        };
      }

      await markRecipientAttempt({
        jobId: latestJob.id,
        status: "FAILED",
        lastError: message,
        failureCode,
        failureSource: "GMAIL"
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
  failureCode?: FailureCode;
  failureSource?: FailureSource;
  /** Gmail thread id of the initial send (captured for same-thread follow-ups). */
  gmailThreadId?: string;
  /** RFC822 Message-ID set on the initial send (for follow-up References). */
  initialMessageIdHeader?: string;
  /** Initial follow-up lifecycle status to set (e.g. "PENDING" once delivered). */
  followUpStatus?: string;
}) {
  const current = await prisma.recipientJob.findUniqueOrThrow({
    where: { id: args.jobId },
    select: {
      retryCount: true,
      metadata: true
    }
  });
  const currentMetadata =
    current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {};
  const retryable = args.failureCode ? isRetryableFailure(args.failureCode) : false;
  const nextRetryAt =
    args.status === "RETRYING" && args.failureCode ? getNextRetryAt(args.failureCode, current.retryCount) : null;
  const now = new Date();
  const updated = await prisma.recipientJob.update({
    where: { id: args.jobId },
    data: {
      status: args.status,
      providerMessageId: args.providerMessageId,
      lastError: args.status === "SENT" ? null : args.lastError ?? null,
      retryCount: args.status === "RETRYING" ? { increment: 1 } : undefined,
      nextRetryAt,
      ...(args.gmailThreadId ? { gmailThreadId: args.gmailThreadId } : {}),
      ...(args.initialMessageIdHeader ? { initialMessageIdHeader: args.initialMessageIdHeader } : {}),
      ...(args.followUpStatus ? { followUpStatus: args.followUpStatus } : {}),
      metadata: {
        ...currentMetadata,
        failureCode: args.status === "SENT" ? null : args.failureCode ?? null,
        failureSource: args.status === "SENT" ? null : args.failureSource ?? null,
        retryable: args.status === "SENT" ? false : retryable,
        lastAttemptAt: now.toISOString(),
        resolvedAt: args.status === "SENT" ? now.toISOString() : null
      } as Prisma.InputJsonValue
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

type FollowUpJobWithContext = Prisma.RecipientJobGetPayload<{
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

async function markFollowUpResult(jobId: string, status: "SENT" | "FAILED" | "SKIPPED", error: string | null) {
  await prisma.recipientJob.update({
    where: { id: jobId },
    data: {
      followUpStatus: status,
      followUpError: status === "SENT" ? null : error,
      followUpSentAt: status === "SENT" ? new Date() : undefined,
      followUpNextRetryAt: null
    }
  });
}

/**
 * Send the follow-up email for a single recipient. Reuses the same guardrails
 * as the initial send: per-sender rate window, suppression checks, sender
 * OAuth validation, retry/backoff. Same-thread mode replies inside the
 * original Gmail thread; new-email mode sends a standalone message.
 */
async function sendFollowUpForRecipient(
  job: FollowUpJobWithContext
): Promise<{ processed: boolean; rateLimited: boolean }> {
  const outcome = await withRedisLock(
    `sendloom:follow-up-job:${job.id}`,
    RECIPIENT_LOCK_TTL_SECONDS,
    async () => {
      const fresh = await prisma.recipientJob.findUnique({
        where: { id: job.id },
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

      if (!fresh || fresh.followUpStatus !== "PENDING") {
        return { processed: false, rateLimited: false };
      }

      if (fresh.followUpNextRetryAt && fresh.followUpNextRetryAt > new Date()) {
        return { processed: false, rateLimited: false };
      }

      const campaign = fresh.campaignRun.campaign;
      if (
        !campaign.followUpEnabled ||
        !campaign.followUpScheduledAt ||
        campaign.followUpScheduledAt > new Date() ||
        ["PAUSED", "CANCELLED", "FAILED"].includes(campaign.status)
      ) {
        return { processed: false, rateLimited: false };
      }

      const sendMode = campaign.followUpSendMode as FollowUpSendMode | null;
      const snapshot = campaign.followUpTemplateSnapshot as FollowUpTemplateSnapshot | null;
      if (!sendMode || !snapshot) {
        await markFollowUpResult(fresh.id, "FAILED", "Follow-up configuration is missing.");
        return { processed: true, rateLimited: false };
      }

      // Skip recipients who unsubscribed or were suppressed after the initial send.
      const suppressed = await getSuppressedEmailsForUser(campaign.userId);
      if (suppressed.has(fresh.recipientEmail.toLowerCase())) {
        await markFollowUpResult(fresh.id, "SKIPPED", "Recipient unsubscribed before the follow-up.");
        return { processed: true, rateLimited: false };
      }

      // Same-thread follow-ups need the original Gmail thread metadata.
      if (sendMode === "same_thread" && !fresh.gmailThreadId) {
        await markFollowUpResult(fresh.id, "SKIPPED", "Missing Gmail thread id from the original send.");
        return { processed: true, rateLimited: false };
      }

      if (!campaign.senderProfile.oauthRefreshToken) {
        await markFollowUpResult(fresh.id, "FAILED", GMAIL_RECONNECT_ERROR);
        return { processed: true, rateLimited: false };
      }

      const rateWindow = await consumeSendWindow(
        getSendWindowKey({
          userId: campaign.userId ?? campaign.senderProfile.userId,
          senderProfileId: campaign.senderProfileId
        })
      );
      if (!rateWindow.allowed) {
        return { processed: false, rateLimited: true };
      }

      const importRow = await prisma.importRow.findUnique({ where: { id: fresh.importRowId } });
      const mappingSnapshot = campaign.mappingSnapshot as {
        reservedFieldMap?: Record<string, string>;
        variableMap?: Record<string, string>;
      };
      const payload = importRow
        ? buildMergePayload(importRow.normalized as Record<string, unknown>, mappingSnapshot)
        : {};
      const followUpFormat = (snapshot.format as TemplateFormat | undefined) ?? "HTML";
      const renderedBody = renderTemplateContent(followUpFormat, snapshot.htmlBody, payload);
      const subject =
        sendMode === "same_thread" ? toReplySubject(fresh.subject) : renderTemplate(snapshot.subject, payload);

      if (sendMode === "new_email" && !subject.trim()) {
        await markFollowUpResult(fresh.id, "FAILED", "Follow-up subject is empty.");
        return { processed: true, rateLimited: false };
      }

      const sender = campaign.senderSnapshot as { fromEmail: string; name: string };
      const senderDomain = campaign.senderProfile.fromEmail.split("@")[1] || "sendloom.app";
      const followUpMessageId = `<slf-${fresh.id}-${Date.now()}@${senderDomain}>`;

      try {
        const response = await sendEmail({
          from: `${sender.name} <${sender.fromEmail}>`,
          to: fresh.recipientEmail,
          subject,
          html: renderedBody,
          messageId: followUpMessageId,
          sender: {
            fromEmail: campaign.senderProfile.fromEmail,
            oauthRefreshToken: campaign.senderProfile.oauthRefreshToken
          },
          ...(sendMode === "same_thread" && fresh.gmailThreadId
            ? {
                threadId: fresh.gmailThreadId,
                ...(fresh.initialMessageIdHeader
                  ? {
                      inReplyTo: fresh.initialMessageIdHeader,
                      references: [fresh.initialMessageIdHeader]
                    }
                  : {})
              }
            : {})
        });

        await prisma.recipientJob.update({
          where: { id: fresh.id },
          data: {
            followUpStatus: "SENT",
            followUpSentAt: new Date(),
            followUpError: null,
            followUpMessageId: response.data?.id ?? null,
            followUpAttemptCount: fresh.followUpAttemptCount + 1,
            followUpNextRetryAt: null
          }
        });

        return { processed: true, rateLimited: false };
      } catch (error) {
        const message = getUserSafeGmailSendError(error);

        if (isGmailReconnectError(error)) {
          await markSenderRequiresReconnect(campaign.senderProfile.id);
          await markFollowUpResult(fresh.id, "FAILED", GMAIL_RECONNECT_ERROR);
          return { processed: true, rateLimited: false };
        }

        console.error("[follow-up-send] Delivery failed.", error);

        const failureCode = classifySendFailure(error, {
          senderConnected: Boolean(campaign.senderProfile.oauthRefreshToken)
        });
        const attempts = fresh.followUpAttemptCount + 1;

        if (attempts < MAX_FOLLOW_UP_ATTEMPTS && isRetryableFailure(failureCode)) {
          await prisma.recipientJob.update({
            where: { id: fresh.id },
            data: {
              followUpStatus: "PENDING",
              followUpAttemptCount: attempts,
              followUpError: message,
              followUpNextRetryAt: getNextRetryAt(failureCode, fresh.followUpAttemptCount)
            }
          });
          return { processed: true, rateLimited: false };
        }

        await prisma.recipientJob.update({
          where: { id: fresh.id },
          data: {
            followUpStatus: "FAILED",
            followUpAttemptCount: attempts,
            followUpError: message,
            followUpNextRetryAt: null
          }
        });
        return { processed: true, rateLimited: false };
      }
    }
  );

  return outcome ?? { processed: false, rateLimited: false };
}

/** Mark a follow-up-only campaign COMPLETED once every follow-up has resolved. */
async function finalizeFollowUpCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true }
  });

  if (!campaign || campaign.status !== "RUNNING") {
    return;
  }

  const [pendingFollowUps, activeRuns] = await Promise.all([
    prisma.recipientJob.count({
      where: { campaignRun: { campaignId }, followUpStatus: "PENDING" }
    }),
    prisma.campaignRun.count({
      where: { campaignId, status: { in: ["QUEUED", "RUNNING"] } }
    })
  ]);

  if (pendingFollowUps === 0 && activeRuns === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" }
    });
  }
}

/**
 * Server-side follow-up scheduler. Finds recipients whose follow-up is due
 * (campaign follow-up enabled, scheduled time reached, initial send delivered)
 * and sends each one. Runs from the campaign cron — never the browser.
 */
async function processDueFollowUps(deadline: number, maxJobs = DEFAULT_MAX_RECIPIENT_JOBS_PER_RUN) {
  const now = new Date();
  const candidates = await prisma.recipientJob.findMany({
    where: {
      followUpStatus: "PENDING",
      OR: [{ followUpNextRetryAt: null }, { followUpNextRetryAt: { lte: now } }],
      campaignRun: {
        campaign: {
          followUpEnabled: true,
          followUpScheduledAt: { lte: now },
          status: { notIn: ["PAUSED", "CANCELLED", "FAILED"] },
          userId: { not: null },
          senderProfile: {
            oauthRefreshToken: { not: null }
          }
        }
      }
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
    orderBy: [{ followUpNextRetryAt: "asc" }, { createdAt: "asc" }],
    take: maxJobs
  });

  const affectedCampaignIds = new Set<string>();
  let processed = 0;

  for (const job of candidates) {
    if (!hasTimeRemaining(deadline)) {
      break;
    }

    affectedCampaignIds.add(job.campaignRun.campaignId);
    const result = await sendFollowUpForRecipient(job);
    if (result.processed) {
      processed += 1;
    }
    if (result.rateLimited) {
      break;
    }
  }

  for (const campaignId of affectedCampaignIds) {
    await finalizeFollowUpCampaign(campaignId);
  }

  return { processed, candidates: candidates.length };
}

export type FollowUpStats = {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
};

/** Aggregate per-recipient follow-up counts across a set of campaign runs. */
export async function getFollowUpStats(campaignRunIds: string[]): Promise<FollowUpStats> {
  const empty: FollowUpStats = { pending: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
  if (!campaignRunIds.length) {
    return empty;
  }

  const rows = await prisma.recipientJob.groupBy({
    by: ["followUpStatus"],
    where: {
      campaignRunId: { in: campaignRunIds },
      followUpStatus: { not: null }
    },
    _count: true
  });

  const counts = Object.fromEntries(rows.map((row) => [row.followUpStatus, row._count]));
  const pending = counts.PENDING ?? 0;
  const sent = counts.SENT ?? 0;
  const failed = counts.FAILED ?? 0;
  const skipped = counts.SKIPPED ?? 0;

  return { pending, sent, failed, skipped, total: pending + sent + failed + skipped };
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

  // Follow-up sweep — only on the unscoped cron pass, never the per-run after() hooks.
  let followUpsProcessed = 0;
  if (!args.runId && !args.campaignId) {
    try {
      if (hasTimeRemaining(deadline)) {
        const followUpResult = await processDueFollowUps(deadline, maxRecipientJobsPerRun);
        followUpsProcessed = followUpResult.processed;
      }
    } catch (error) {
      console.error("[campaign-cron] Follow-up processing failed.", error);
      errors.push({
        scope: "campaign-run",
        message: getErrorMessage(error)
      });
    }
  }

  const [remainingRuns, remainingFollowUps] = await Promise.all([
    prisma.campaignRun.count({
      where: dueRunWhere
    }),
    prisma.recipientJob.count({
      where: {
        followUpStatus: "PENDING",
        campaignRun: {
          campaign: {
            followUpEnabled: true,
            followUpScheduledAt: { lte: new Date() },
            status: { notIn: ["PAUSED", "CANCELLED", "FAILED"] }
          }
        }
      }
    })
  ]);

  return {
    dueCampaignsFound,
    runsCreated: scheduling.runsCreated,
    scheduledCampaignsScanned: scheduling.campaignsScanned,
    schedulingLockSkipped: scheduling.lockSkipped,
    runsProcessed,
    recipientJobsProcessed,
    followUpsProcessed,
    hasRemainingWork: hasRemainingWork || remainingRuns > 0 || remainingFollowUps > 0,
    errors
  };
}
