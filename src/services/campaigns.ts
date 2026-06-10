import { Prisma, type CampaignStatus } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { CAMPAIGN_SETUP_LOCKED_RUN_STATUSES, isCampaignSetupLocked } from "@/lib/campaign-setup-lock";
import {
  SCHEDULE_EDIT_DISABLED_MESSAGE,
  canEditCampaignSchedule,
  planCampaignScheduleUpdate
} from "@/lib/campaign-schedule-edit";
import {
  planScheduledCampaignRun,
  SCHEDULABLE_CAMPAIGN_STATUSES
} from "@/lib/campaign-scheduling";
import { getGmailDailySendWindow, releaseSendReservation, reserveSendCapacity } from "@/lib/daily-send-limit";
import { prisma } from "@/lib/db";
import type { FailureCode, FailureSource } from "@/lib/failures";
import {
  buildGmailSendFailureMetadata,
  getGmailRetryAfterDate,
  type GmailSendFailureMetadata
} from "@/lib/gmail-errors";
import { buildMergePayload } from "@/lib/mapping";
import {
  GMAIL_RECONNECT_ERROR,
  getUserSafeGmailSendError,
  isGmailDailyLimitError,
  isGmailReconnectError,
  sendEmail,
  type EmailAttachment
} from "@/lib/provider";
import { consumeSendWindow, getGmailSendsPerMinute, getSendWindowKey } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { isManuallyRetriableFailedJob } from "@/lib/retry-eligibility";
import { classifySendFailure, getNextRetryAt, isRetryableFailure, MAX_RETRY_ATTEMPTS } from "@/lib/retry-policy";
import { recordSendOnLedger } from "@/services/send-ledger";
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
const GMAIL_RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const GMAIL_PROVIDER_DAILY_LIMIT_RETRY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_RECIPIENT_STATUSES = new Set(["SENT", "SUPPRESSED", "INVALID", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED"]);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logGmailSendFailure(
  event: "campaign-send",
  args: {
    campaignId: string;
    campaignRunId: string;
    recipientJobId: string;
    senderProfileId: string;
    userId: string | null;
    failureCode: FailureCode;
    retryable: boolean;
    attemptNumber: number;
    nextRetryAt?: Date | null;
    failureDetails: GmailSendFailureMetadata;
  }
) {
  const diagnostic = args.failureDetails.lastInternalError;

  console.error(`[${event}] Gmail send failed.`, {
    campaignId: args.campaignId,
    campaignRunId: args.campaignRunId,
    recipientJobId: args.recipientJobId,
    senderProfileId: args.senderProfileId,
    userId: args.userId,
    provider: diagnostic.provider,
    gmailHttpStatus: diagnostic.httpStatus,
    gmailCode: diagnostic.code,
    gmailStatus: diagnostic.status,
    gmailReason: diagnostic.reason,
    gmailMessage: diagnostic.message,
    failureCode: args.failureCode,
    retryable: args.retryable,
    attemptNumber: args.attemptNumber,
    nextRetryAt: args.nextRetryAt?.toISOString() ?? null
  });
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
          id: true,
          name: true,
          userId: true,
          user: {
            select: {
              email: true
            }
          }
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

  const counts = await syncRunCounts(runId);

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

  // Aggregate send outcome for the admin audit timeline, attributed to the
  // sequence owner. recordAuditEvent is best-effort and never throws here.
  if (run.campaign.user?.email) {
    const failedCount = counts.FAILED ?? 0;
    await recordAuditEvent({
      actor: { id: run.campaign.userId, email: run.campaign.user.email },
      action: "send.run_completed",
      category: "EMAIL_SEND",
      severity: failedCount > 0 ? "WARNING" : "SUCCESS",
      target: { type: "sequence", id: run.campaignId, name: run.campaign.name },
      message: `Send run completed for ${run.campaign.name}.`,
      metadata: {
        runId,
        totalRecipients: run.totalRecipients,
        sent: counts.SENT ?? 0,
        failed: failedCount,
        suppressed: counts.SUPPRESSED ?? 0,
        invalid: counts.INVALID ?? 0
      }
    });
  }

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

export async function createCampaignDraft(input: {
  name: string;
  importId: string;
  mappingId: string;
  templateId: string;
  senderProfileId: string;
  scheduleRule: ScheduleRule;
  attachments?: CampaignAttachmentSnapshot[];
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

  const nextScheduledFor = scheduleRule.type === "immediate" ? new Date() : getNextRunDate(scheduleRule);

  // Decide how this edit affects the campaign lifecycle. Critically, when the
  // latest run has already completed/failed, switching to a scheduled send must
  // queue a brand-new run and reset the campaign to SCHEDULED — otherwise a
  // finished "send right away" sequence stays COMPLETED and never re-sends.
  const { runAction, nextStatus: nextCampaignStatus } = planCampaignScheduleUpdate({
    campaignStatus: campaign.status,
    hasValidatedSnapshot: Boolean(campaign.lastValidatedAt),
    scheduleType: scheduleRule.type,
    latestRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          recipientJobCount: latestRun._count.recipientJobs,
          scheduledFor: latestRun.scheduledFor
        }
      : null
  });

  return prisma.$transaction(async (tx) => {
    const updatedCampaign = await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        scheduleType: scheduleRule.type,
        scheduleConfig: scheduleRule as Prisma.InputJsonValue,
        status: nextCampaignStatus
      }
    });

    if (runAction === "reuse" && latestRun) {
      const updatedRun = await tx.campaignRun.update({
        where: { id: latestRun.id },
        data: {
          launchType: scheduleRule.type,
          scheduledFor: nextScheduledFor
        }
      });

      return { campaign: updatedCampaign, run: updatedRun };
    }

    if (runAction === "create") {
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

export type RetryFailedRecipientsResult =
  | { status: "ok"; retried: number; run: { id: string; status: string } }
  | { status: "not_found" }
  | { status: "no_failures" }
  | { status: "run_active" }
  | { status: "paused" }
  | { status: "sender_disconnected" }
  | { status: "daily_limit"; resumeAt: string | null }
  | { status: "locked" };

/**
 * Re-queue only the eligible failed recipients of a sequence's latest finished
 * run so they retry through the exact same safe send pipeline as a normal run
 * (Gmail auth check, per-sender pacing, daily safety limit, retry policy,
 * suppression/unsubscribe checks, provider diagnostics). Successful, opened,
 * delivered, suppressed, invalid, and unsubscribed recipients are never touched,
 * and the full recipient list is never duplicated — the existing run is reopened
 * in place. A Redis lock plus the "already active" guard prevent a double-click
 * from queueing duplicate retries.
 */
export async function retryFailedRecipients(
  campaignId: string,
  userId: string
): Promise<RetryFailedRecipientsResult> {
  const outcome = await withRedisLock(
    `sendloom:campaign-retry-failed:${campaignId}`,
    RUN_LOCK_TTL_SECONDS,
    async (): Promise<RetryFailedRecipientsResult> => {
      const campaign = await prisma.campaign.findFirst({
        where: campaignOwnershipFilter(campaignId, userId),
        include: {
          senderProfile: {
            select: { id: true, userId: true, oauthRefreshToken: true }
          },
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, startedAt: true }
          }
        }
      });

      if (!campaign) {
        return { status: "not_found" };
      }

      const latestRun = campaign.runs[0] ?? null;
      if (!latestRun) {
        return { status: "no_failures" };
      }

      // Never reopen a run that is still sending, or one that the user paused.
      if (["QUEUED", "RUNNING"].includes(latestRun.status) || ["RUNNING", "QUEUED"].includes(campaign.status)) {
        return { status: "run_active" };
      }
      if (latestRun.status === "PAUSED" || campaign.status === "PAUSED") {
        return { status: "paused" };
      }
      if (!campaign.senderProfile.oauthRefreshToken) {
        return { status: "sender_disconnected" };
      }

      const sendWindow = await getGmailDailySendWindow({
        userId: campaign.userId ?? campaign.senderProfile.userId,
        senderProfileId: campaign.senderProfileId
      });
      if (sendWindow.isBlocked) {
        return { status: "daily_limit", resumeAt: sendWindow.resetAt };
      }

      const failedJobs = await prisma.recipientJob.findMany({
        where: { campaignRunId: latestRun.id, status: "FAILED" },
        select: { id: true, status: true, recipientEmail: true, metadata: true }
      });
      if (failedJobs.length === 0) {
        return { status: "no_failures" };
      }

      const suppressedEmails = await getSuppressedEmailsForUser(campaign.userId);
      const eligibleIds = failedJobs
        .filter(
          (job) =>
            isManuallyRetriableFailedJob(job) && !suppressedEmails.has(job.recipientEmail.toLowerCase())
        )
        .map((job) => job.id);

      if (eligibleIds.length === 0) {
        return { status: "no_failures" };
      }

      await prisma.$transaction([
        // Reset only the eligible failed jobs back to PENDING with a fresh retry
        // budget. Other recipients in the run keep their terminal state, so
        // successful sends are never resent. Stale failure metadata is harmless
        // on a PENDING job and is overwritten on the next attempt.
        prisma.recipientJob.updateMany({
          where: { id: { in: eligibleIds } },
          data: {
            status: "PENDING",
            lastError: null,
            nextRetryAt: null,
            retryCount: 0
          }
        }),
        prisma.campaignRun.update({
          where: { id: latestRun.id },
          data: {
            status: "QUEUED",
            scheduledFor: new Date(),
            startedAt: latestRun.startedAt ?? new Date(),
            completedAt: null
          }
        }),
        prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "RUNNING" }
        })
      ]);

      await syncRunCounts(latestRun.id);

      const refreshed = await prisma.campaignRun.findUniqueOrThrow({
        where: { id: latestRun.id },
        select: { id: true, status: true }
      });

      return { status: "ok", retried: eligibleIds.length, run: refreshed };
    }
  );

  return outcome ?? { status: "locked" };
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

    // Not yet due: a future nextRetryAt means either a backoff retry or a job
    // deferred for per-minute pacing. Either way, leave it queued.
    if (latestJob.nextRetryAt && latestJob.nextRetryAt > new Date()) {
      return {
        processed: false,
        rateLimited: false
      };
    }

    const scope = {
      userId: latestJob.campaignRun.campaign.userId ?? latestJob.campaignRun.campaign.senderProfile.userId,
      senderProfileId: latestJob.campaignRun.campaign.senderProfileId
    };
    let activeReservationId: string | null = null;

    try {
      const dailyReservation = await reserveSendCapacity(scope);
      if (!dailyReservation.allowed) {
        const resumeAt = dailyReservation.window.resetAt ? new Date(dailyReservation.window.resetAt) : null;
        await pauseCampaignRunForDailyLimit({
          runId: latestJob.campaignRunId,
          jobId: latestJob.id,
          message: "Sendloom paused sending to stay under Gmail's daily safety limit.",
          resumeAt,
          scope
        });
        return {
          processed: true,
          rateLimited: true
        };
      }
      activeReservationId = dailyReservation.reservationId;

      const rateWindow = await consumeSendWindow(
        getSendWindowKey({
          userId: scope.userId,
          senderProfileId: scope.senderProfileId
        })
      );
      if (!rateWindow.allowed) {
        // Proactive per-sender pacing: defer to the next send window. Not a
        // failure — keep the recipient queued, don't touch retryCount, don't
        // call Gmail. `processed: false` so the scheduler doesn't count this as
        // progress (it moves on to other senders' runs).
        await releaseSendReservation(scope, activeReservationId);
        activeReservationId = null;
        await deferRecipientForSendWindow({ jobId: latestJob.id, retryAt: rateWindow.retryAt });

        return {
          processed: false,
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

      await recordSendOnLedger({
        scope,
        reservationId: activeReservationId,
        campaignId: latestJob.campaignRun.campaignId,
        campaignRunId: latestJob.campaignRunId,
        recipientJobId: latestJob.id,
        messageId: response.data?.id ?? null
      });
      activeReservationId = null;

      return {
        processed: true,
        rateLimited: false
      };
    } catch (error) {
      if (activeReservationId) {
        await releaseSendReservation(scope, activeReservationId);
        activeReservationId = null;
      }

      const failureCode = classifySendFailure(error, {
        senderConnected: Boolean(latestJob.campaignRun.campaign.senderProfile.oauthRefreshToken)
      });
      const retryable = isRetryableFailure(failureCode);
      const message = getUserSafeGmailSendError(error, failureCode);
      const failureDetails = buildGmailSendFailureMetadata(error, {
        failureCode,
        retryable
      });
      const logContext = {
        campaignId: latestJob.campaignRun.campaignId,
        campaignRunId: latestJob.campaignRunId,
        recipientJobId: latestJob.id,
        senderProfileId: latestJob.campaignRun.campaign.senderProfileId,
        userId: latestJob.campaignRun.campaign.userId,
        failureCode,
        retryable,
        attemptNumber: latestJob.retryCount + 1,
        failureDetails
      };

      if (isGmailReconnectError(error)) {
        await markSenderRequiresReconnect(latestJob.campaignRun.campaign.senderProfile.id);

        const updated = await markRecipientAttempt({
          jobId: latestJob.id,
          status: "FAILED",
          lastError: GMAIL_RECONNECT_ERROR,
          failureCode,
          failureSource: "GMAIL",
          failureDetails
        });
        logGmailSendFailure("campaign-send", {
          ...logContext,
          nextRetryAt: updated.nextRetryAt
        });

        await failQueuedRecipientJobs(latestJob.campaignRunId, GMAIL_RECONNECT_ERROR, latestJob.id);

        return {
          processed: true,
          rateLimited: false
        };
      }

      if (isGmailDailyLimitError(error)) {
        const resumeAt = getGmailRetryAfterDate(error, GMAIL_PROVIDER_DAILY_LIMIT_RETRY_MS);
        await pauseCampaignRunForSenderLimit({
          runId: latestJob.campaignRunId,
          jobId: latestJob.id,
          message,
          resumeAt,
          failureDetails
        });
        logGmailSendFailure("campaign-send", {
          ...logContext,
          nextRetryAt: resumeAt
        });

        return {
          processed: true,
          rateLimited: true
        };
      }

      if (latestJob.retryCount < MAX_RETRY_ATTEMPTS && retryable) {
        const updated = await markRecipientAttempt({
          jobId: latestJob.id,
          status: "RETRYING",
          lastError: message,
          failureCode,
          failureSource: "GMAIL",
          failureDetails
        });
        logGmailSendFailure("campaign-send", {
          ...logContext,
          nextRetryAt: updated.nextRetryAt
        });

        return {
          processed: true,
          rateLimited: failureCode === "GMAIL_RATE_LIMITED"
        };
      }

      if (failureCode === "GMAIL_RATE_LIMITED") {
        const resumeAt = getGmailRetryAfterDate(error, GMAIL_RATE_LIMIT_PAUSE_MS);
        await pauseCampaignRunForSenderLimit({
          runId: latestJob.campaignRunId,
          jobId: latestJob.id,
          message,
          resumeAt,
          failureDetails
        });
        logGmailSendFailure("campaign-send", {
          ...logContext,
          nextRetryAt: resumeAt
        });

        return {
          processed: true,
          rateLimited: true
        };
      }

      const updated = await markRecipientAttempt({
        jobId: latestJob.id,
        status: "FAILED",
        lastError: message,
        failureCode,
        failureSource: "GMAIL",
        failureDetails
      });
      logGmailSendFailure("campaign-send", {
        ...logContext,
        nextRetryAt: updated.nextRetryAt
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

    const now = new Date();
    const candidateJobs = await prisma.recipientJob.findMany({
      where: {
        campaignRunId: run.id,
        OR: [
          {
            // PENDING jobs deferred for per-minute pacing carry a future
            // nextRetryAt — skip them until their send window frees.
            status: "PENDING",
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
          },
          {
            status: "RETRYING",
            nextRetryAt: {
              lte: now
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
  failureDetails?: Record<string, unknown>;
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
  const clearedFailureDetails = {
    failureCategory: null,
    provider: null,
    providerErrorCode: null,
    providerErrorReason: null,
    providerErrorStatus: null,
    providerHttpStatus: null,
    providerErrorMessage: null,
    providerRetryAfterSeconds: null,
    lastInternalError: null
  };
  const updated = await prisma.recipientJob.update({
    where: { id: args.jobId },
    data: {
      status: args.status,
      providerMessageId: args.providerMessageId,
      lastError: args.status === "SENT" ? null : args.lastError ?? null,
      retryCount: args.status === "RETRYING" ? { increment: 1 } : undefined,
      nextRetryAt,
      metadata: {
        ...currentMetadata,
        ...(args.status === "SENT" ? clearedFailureDetails : (args.failureDetails ?? {})),
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

/**
 * Per-minute pacing reached for this sender — defer the recipient to the next
 * send window WITHOUT treating it as a failure. Pacing is a deliberate throttle,
 * not a delivery error, so we must NOT increment retryCount, set a failure code,
 * or mark the job FAILED/permanent (doing exactly that is what surfaced paced
 * recipients as "Failed / Permanent" and burned their retry budget). The job
 * stays PENDING with a future nextRetryAt so the candidate query skips it until
 * the window frees, and a benign metadata marker lets the activity list show a
 * "Queued / waiting for the send window" state instead of an error.
 *
 * This is independent of the rolling 24h daily cap: no daily slot is consumed
 * (the caller releases its reservation before deferring).
 */
export async function deferRecipientForSendWindow(args: { jobId: string; retryAt: Date }) {
  const current = await prisma.recipientJob.findUniqueOrThrow({
    where: { id: args.jobId },
    select: { metadata: true }
  });
  const currentMetadata =
    current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {};

  const updated = await prisma.recipientJob.update({
    where: { id: args.jobId },
    data: {
      status: "PENDING",
      lastError: null,
      nextRetryAt: args.retryAt,
      metadata: {
        ...currentMetadata,
        failureCode: null,
        failureSource: null,
        retryable: true,
        blockedBy: "GMAIL_SENDER_PACING",
        blockedAt: new Date().toISOString(),
        blockedUntil: args.retryAt.toISOString()
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
  resumeAt?: Date | null;
  failureDetails?: Record<string, unknown>;
}) {
  await prisma.$transaction(async (tx) => {
    const pausedAt = new Date();

    if (args.jobId) {
      const job = await tx.recipientJob.findUniqueOrThrow({
        where: { id: args.jobId },
        select: { metadata: true }
      });
      const currentMetadata =
        job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
          ? (job.metadata as Record<string, unknown>)
          : {};

      await tx.recipientJob.update({
        where: { id: args.jobId },
        data: {
          status: "PENDING",
          lastError: null,
          nextRetryAt: args.resumeAt ?? null,
          metadata: {
            ...currentMetadata,
            ...(args.failureDetails ?? {}),
            failureCode: "GMAIL_RATE_LIMITED",
            failureSource: "GMAIL",
            retryable: true,
            blockedBy: "GMAIL_SENDER_LIMIT",
            blockedAt: pausedAt.toISOString(),
            blockedUntil: args.resumeAt?.toISOString() ?? null
          } as Prisma.InputJsonValue
        }
      });
    }

    const existingRun = await tx.campaignRun.findUniqueOrThrow({
      where: { id: args.runId },
      select: { progressSnapshot: true, campaignId: true }
    });
    const existingSnapshot =
      existingRun.progressSnapshot && typeof existingRun.progressSnapshot === "object" && !Array.isArray(existingRun.progressSnapshot)
        ? (existingRun.progressSnapshot as Record<string, unknown>)
        : {};

    const run = await tx.campaignRun.update({
      where: { id: args.runId },
      data: {
        status: "PAUSED",
        progressSnapshot: {
          ...existingSnapshot,
          pauseReason: "GMAIL_SENDER_LIMIT",
          pauseMessage: args.message,
          pauseResumesAt: args.resumeAt?.toISOString() ?? null,
          pausedAt: pausedAt.toISOString()
        } as Prisma.InputJsonValue
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

/**
 * Pause a run because the rolling 24h Gmail safety limit was hit. Unlike
 * `pauseCampaignRunForSenderLimit`, this does NOT mark the in-flight recipient
 * job as failed — the recipient hasn't done anything wrong, the sender hit the
 * cap. The job stays PENDING and resumes automatically once `resumeAt` passes.
 *
 * `progressSnapshot` is reused as the place to store the pause reason so we
 * don't need a schema change. `resumeCampaignRunsBlockedByDailyLimit` reads it.
 */
export async function pauseCampaignRunForDailyLimit(args: {
  runId: string;
  jobId?: string;
  message: string;
  resumeAt: Date | null;
  scope: { userId?: string | null; senderProfileId?: string | null };
}) {
  await prisma.$transaction(async (tx) => {
    if (args.jobId) {
      const job = await tx.recipientJob.findUniqueOrThrow({
        where: { id: args.jobId },
        select: { metadata: true }
      });
      const currentMetadata =
        job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
          ? (job.metadata as Record<string, unknown>)
          : {};

      await tx.recipientJob.update({
        where: { id: args.jobId },
        data: {
          // Keep the recipient PENDING so it picks up automatically on resume.
          status: "PENDING",
          lastError: null,
          nextRetryAt: null,
          metadata: {
            ...currentMetadata,
            blockedBy: "DAILY_SEND_LIMIT",
            blockedAt: new Date().toISOString(),
            blockedUntil: args.resumeAt?.toISOString() ?? null
          } as Prisma.InputJsonValue
        }
      });
    }

    const existingRun = await tx.campaignRun.findUniqueOrThrow({
      where: { id: args.runId },
      select: { progressSnapshot: true, campaignId: true }
    });
    const existingSnapshot =
      existingRun.progressSnapshot && typeof existingRun.progressSnapshot === "object" && !Array.isArray(existingRun.progressSnapshot)
        ? (existingRun.progressSnapshot as Record<string, unknown>)
        : {};

    await tx.campaignRun.update({
      where: { id: args.runId },
      data: {
        status: "PAUSED",
        progressSnapshot: {
          ...existingSnapshot,
          pauseReason: "DAILY_SEND_LIMIT",
          pauseMessage: args.message,
          pauseResumesAt: args.resumeAt?.toISOString() ?? null,
          pausedSenderProfileId: args.scope.senderProfileId ?? null,
          pausedUserId: args.scope.userId ?? null,
          pausedAt: new Date().toISOString()
        } as Prisma.InputJsonValue
      }
    });

    await tx.campaign.update({
      where: { id: existingRun.campaignId },
      data: {
        status: "PAUSED"
      }
    });
  });

  await syncRunCounts(args.runId);

  // Surface the safety pause on the owner's audit timeline. Best-effort —
  // recordAuditEvent never throws for non-critical events.
  if (args.scope.userId) {
    const owner = await prisma.user
      .findUnique({ where: { id: args.scope.userId }, select: { email: true } })
      .catch(() => null);

    if (owner) {
      await recordAuditEvent({
        actor: { id: args.scope.userId, email: owner.email },
        action: "send.daily_limit_reached",
        category: "EMAIL_SEND",
        severity: "WARNING",
        target: { type: "run", id: args.runId },
        message: "Gmail's rolling 24h safety limit paused sending. It resumes automatically.",
        metadata: {
          resumeAt: args.resumeAt?.toISOString() ?? null,
          senderProfileId: args.scope.senderProfileId ?? null
        }
      });
    }
  }
}

type DailyLimitPauseInfo = {
  pauseReason?: "DAILY_SEND_LIMIT" | "GMAIL_SENDER_LIMIT";
  pauseMessage?: string;
  pauseResumesAt?: string | null;
  pausedAt?: string;
  pausedSenderProfileId?: string | null;
  pausedUserId?: string | null;
};

export function readDailyLimitPauseInfo(progressSnapshot: unknown): DailyLimitPauseInfo | null {
  if (!progressSnapshot || typeof progressSnapshot !== "object" || Array.isArray(progressSnapshot)) {
    return null;
  }
  const snapshot = progressSnapshot as Record<string, unknown>;
  if (snapshot.pauseReason !== "DAILY_SEND_LIMIT" && snapshot.pauseReason !== "GMAIL_SENDER_LIMIT") {
    return null;
  }
  return {
    pauseReason: snapshot.pauseReason,
    pauseMessage: typeof snapshot.pauseMessage === "string" ? snapshot.pauseMessage : undefined,
    pauseResumesAt: typeof snapshot.pauseResumesAt === "string" ? snapshot.pauseResumesAt : null,
    pausedAt: typeof snapshot.pausedAt === "string" ? snapshot.pausedAt : undefined,
    pausedSenderProfileId:
      typeof snapshot.pausedSenderProfileId === "string" ? snapshot.pausedSenderProfileId : null,
    pausedUserId: typeof snapshot.pausedUserId === "string" ? snapshot.pausedUserId : null
  };
}

/**
 * Auto-resume runs that were paused by system Gmail limits once their resume
 * window has passed. A user-initiated pause has no system pause reason and is
 * left untouched, satisfying "respect manual pause".
 */
export async function resumeCampaignRunsBlockedByDailyLimit(now = new Date()) {
  const candidates = await prisma.campaignRun.findMany({
    where: { status: "PAUSED" },
    select: {
      id: true,
      campaignId: true,
      progressSnapshot: true,
      scheduledFor: true,
      campaign: {
        select: {
          userId: true,
          senderProfileId: true,
          scheduleType: true,
          scheduleConfig: true
        }
      }
    }
  });

  let resumedCount = 0;
  for (const candidate of candidates) {
    const info = readDailyLimitPauseInfo(candidate.progressSnapshot);
    if (!info) {
      continue;
    }
    const pauseResumesAt = info.pauseResumesAt ? new Date(info.pauseResumesAt) : null;
    let shouldResume = !pauseResumesAt || Number.isNaN(pauseResumesAt.getTime()) || pauseResumesAt <= now;

    if (!shouldResume && info.pauseReason === "DAILY_SEND_LIMIT") {
      const window = await getGmailDailySendWindow({
        userId: info.pausedUserId ?? candidate.campaign.userId,
        senderProfileId: info.pausedSenderProfileId ?? candidate.campaign.senderProfileId
      });
      shouldResume = window.ledgerAvailable && !window.isBlocked;
    }

    if (!shouldResume) {
      continue;
    }

    const existingSnapshot =
      candidate.progressSnapshot && typeof candidate.progressSnapshot === "object" && !Array.isArray(candidate.progressSnapshot)
        ? (candidate.progressSnapshot as Record<string, unknown>)
        : {};
    const clearedSnapshot = { ...existingSnapshot };
    delete clearedSnapshot.pauseReason;
    delete clearedSnapshot.pauseMessage;
    delete clearedSnapshot.pauseResumesAt;
    delete clearedSnapshot.pausedAt;
    delete clearedSnapshot.pausedSenderProfileId;
    delete clearedSnapshot.pausedUserId;

    await prisma.$transaction(async (tx) => {
      await tx.campaignRun.update({
        where: { id: candidate.id },
        data: {
          status: "QUEUED",
          scheduledFor: now,
          progressSnapshot: clearedSnapshot as Prisma.InputJsonValue
        }
      });
      await tx.campaign.update({
        where: { id: candidate.campaignId },
        data: { status: "RUNNING" }
      });
    });

    await prisma.recipientJob.updateMany({
      where: {
        campaignRunId: candidate.id,
        status: "PENDING"
      },
      data: {
        nextRetryAt: null
      }
    });

    resumedCount += 1;
  }

  return { resumedCount };
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

  try {
    await resumeCampaignRunsBlockedByDailyLimit();
  } catch (error) {
    console.error("[campaign-cron] Daily-limit auto-resume failed.", error);
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

  const perMinuteLimit = getGmailSendsPerMinute();

  while (hasTimeRemaining(deadline) && runsProcessed < maxRuns) {
    const runs = await prisma.campaignRun.findMany({
      where: dueRunWhere,
      // updatedAt rotates fairness across sequences that share a sender: a run
      // bumps updatedAt every time it advances a job (syncRunCounts), so the run
      // that sent least recently is tried first next pass — round-robin with no
      // schema change. scheduledFor still orders genuinely scheduled runs.
      orderBy: [{ scheduledFor: "asc" }, { updatedAt: "asc" }, { createdAt: "asc" }],
      include: {
        campaign: {
          select: {
            senderProfileId: true
          }
        }
      },
      take: maxRuns
    });

    if (!runs.length) {
      break;
    }

    // How many due runs share each sender, so we can split that sender's
    // per-minute window fairly — one send per run per pass when several compete,
    // instead of letting the first sequence drain the whole 3/min window.
    const runsPerSender = new Map<string, number>();
    for (const run of runs) {
      const senderId = run.campaign.senderProfileId;
      runsPerSender.set(senderId, (runsPerSender.get(senderId) ?? 0) + 1);
    }

    // Senders whose per-minute window filled during this pass. We skip their
    // remaining runs but keep serving other senders — one sender hitting its
    // limit must never block a different connected sender.
    const exhaustedSenders = new Set<string>();
    let progressedThisPass = false;

    for (const run of runs) {
      if (!hasTimeRemaining(deadline) || runsProcessed >= maxRuns) {
        break;
      }

      const senderId = run.campaign.senderProfileId;
      if (exhaustedSenders.has(senderId)) {
        hasRemainingWork = true;
        continue;
      }

      const competingRuns = runsPerSender.get(senderId) ?? 1;
      const fairBatch =
        competingRuns > 1 ? Math.max(1, Math.floor(perMinuteLimit / competingRuns)) : maxRecipientJobsPerRun;

      try {
        const result = await processCampaignRun(run.id, {
          maxDurationMs: Math.max(1_000, deadline - Date.now()),
          maxRecipientJobs: fairBatch
        });

        if (!result.locked) {
          runsProcessed += 1;
        }
        recipientJobsProcessed += result.processedJobs;
        hasRemainingWork = hasRemainingWork || result.hasRemainingWork;
        progressedThisPass =
          progressedThisPass || result.processedJobs > 0 || (!result.locked && !result.hasRemainingWork);

        if (result.rateLimited) {
          // This sender's send window is full for now. Don't break the whole
          // pass — just stop serving this sender and move to the next one.
          hasRemainingWork = true;
          exhaustedSenders.add(senderId);
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
