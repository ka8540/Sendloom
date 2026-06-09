import { Worker, type ConnectionOptions } from "bullmq";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { releaseSendReservation, reserveSendCapacity } from "@/lib/daily-send-limit";
import type { FailureCode } from "@/lib/failures";
import {
  buildGmailSendFailureMetadata,
  getGmailRetryAfterDate,
  type GmailSendFailureMetadata
} from "@/lib/gmail-errors";
import {
  getUserSafeGmailSendError,
  isGmailDailyLimitError,
  sendEmail,
  type EmailAttachment
} from "@/lib/provider";
import { queues } from "@/lib/queue";
import { consumeSendWindow, getSendWindowKey } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { classifySendFailure, isRetryableFailure, MAX_RETRY_ATTEMPTS } from "@/lib/retry-policy";
import {
  deferRecipientForSendWindow,
  enqueueRecipientJobs,
  markRecipientAttempt,
  pauseCampaignRunForDailyLimit,
  pauseCampaignRunForSenderLimit
} from "@/services/campaigns";
import { recordSendOnLedger } from "@/services/send-ledger";

const connection = getRedis() as unknown as ConnectionOptions;
const GMAIL_RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const GMAIL_PROVIDER_DAILY_LIMIT_RETRY_MS = 24 * 60 * 60 * 1000;

function logGmailSendFailure(args: {
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
}) {
  const diagnostic = args.failureDetails.lastInternalError;

  console.error("[worker-send] Gmail send failed.", {
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

const launchWorker = new Worker(
  "launch",
  async (job) => {
    const { campaignId, runId } = job.data as { campaignId: string; runId: string };
    await prisma.campaignRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        startedAt: new Date()
      }
    });
    await enqueueRecipientJobs(campaignId, runId);
  },
  { connection }
);

const sendWorker = new Worker(
  "send",
  async (job) => {
    const { jobId } = job.data as { jobId: string };
    const recipientJob = await prisma.recipientJob.findUniqueOrThrow({
      where: { id: jobId },
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

    if (["SENT", "SUPPRESSED", "INVALID"].includes(recipientJob.status)) {
      return;
    }

    // Not yet due: a future nextRetryAt means a backoff retry or a job deferred
    // for per-minute pacing. Leave it queued for its scheduled time.
    if (recipientJob.nextRetryAt && recipientJob.nextRetryAt > new Date()) {
      return;
    }

    if (recipientJob.campaignRun.status === "PAUSED" || recipientJob.campaignRun.campaign.status === "PAUSED") {
      return;
    }

    const scope = {
      userId: recipientJob.campaignRun.campaign.userId ?? recipientJob.campaignRun.campaign.senderProfile.userId,
      senderProfileId: recipientJob.campaignRun.campaign.senderProfileId
    };

    let activeReservationId: string | null = null;

    try {
      const dailyReservation = await reserveSendCapacity(scope);
      if (!dailyReservation.allowed) {
        const resumeAt = dailyReservation.window.resetAt ? new Date(dailyReservation.window.resetAt) : null;
        await pauseCampaignRunForDailyLimit({
          runId: recipientJob.campaignRunId,
          jobId,
          message: "Sendloom paused sending to stay under Gmail's daily safety limit.",
          resumeAt,
          scope
        });
        if (resumeAt) {
          await queues.send.add(
            "send-recipient",
            { jobId },
            {
              jobId: recipientJob.dedupeKey,
              delay: Math.max(1_000, resumeAt.getTime() - Date.now())
            }
          );
        }
        return;
      }
      activeReservationId = dailyReservation.reservationId;

      const rateWindow = await consumeSendWindow(
        getSendWindowKey({
          userId: scope.userId,
          senderProfileId: scope.senderProfileId
        })
      );
      if (!rateWindow.allowed) {
        // Per-sender pacing reached: defer to the next send window. Not a
        // failure — keep the recipient queued, don't touch retryCount, don't
        // call Gmail. Re-enqueue for the moment the window frees.
        await releaseSendReservation(scope, activeReservationId);
        activeReservationId = null;
        await deferRecipientForSendWindow({ jobId, retryAt: rateWindow.retryAt });
        await queues.send.add(
          "send-recipient",
          { jobId },
          {
            jobId: recipientJob.dedupeKey,
            delay: Math.max(1_000, rateWindow.retryAt.getTime() - Date.now())
          }
        );
        return;
      }

      const sender = recipientJob.campaignRun.campaign.senderSnapshot as {
        fromEmail: string;
        name: string;
      };
      const templateSnapshot = recipientJob.campaignRun.campaign.templateSnapshot as {
        attachments?: EmailAttachment[];
      };
      const response = await sendEmail({
        from: `${sender.name} <${sender.fromEmail}>`,
        to: recipientJob.recipientEmail,
        subject: recipientJob.subject,
        html: recipientJob.htmlBody,
        attachments: templateSnapshot.attachments ?? [],
        sender: {
          fromEmail: recipientJob.campaignRun.campaign.senderProfile.fromEmail,
          oauthRefreshToken: recipientJob.campaignRun.campaign.senderProfile.oauthRefreshToken
        }
      });

      await markRecipientAttempt({
        jobId,
        status: "SENT",
        providerMessageId: response.data?.id
      });

      await recordSendOnLedger({
        scope,
        reservationId: activeReservationId,
        campaignId: recipientJob.campaignRun.campaignId,
        campaignRunId: recipientJob.campaignRunId,
        recipientJobId: jobId,
        messageId: response.data?.id ?? null
      });
      activeReservationId = null;
    } catch (error) {
      if (activeReservationId) {
        await releaseSendReservation(scope, activeReservationId);
        activeReservationId = null;
      }

      const failureCode = classifySendFailure(error, {
        senderConnected: Boolean(recipientJob.campaignRun.campaign.senderProfile.oauthRefreshToken)
      });
      const retryable = isRetryableFailure(failureCode);
      const message = getUserSafeGmailSendError(error, failureCode);
      const failureDetails = buildGmailSendFailureMetadata(error, {
        failureCode,
        retryable
      });
      const logContext = {
        campaignId: recipientJob.campaignRun.campaignId,
        campaignRunId: recipientJob.campaignRunId,
        recipientJobId: jobId,
        senderProfileId: recipientJob.campaignRun.campaign.senderProfileId,
        userId: recipientJob.campaignRun.campaign.userId,
        failureCode,
        retryable,
        attemptNumber: recipientJob.retryCount + 1,
        failureDetails
      };

      if (isGmailDailyLimitError(error)) {
        const resumeAt = getGmailRetryAfterDate(error, GMAIL_PROVIDER_DAILY_LIMIT_RETRY_MS);
        await pauseCampaignRunForSenderLimit({
          runId: recipientJob.campaignRunId,
          jobId,
          message,
          resumeAt,
          failureDetails
        });
        logGmailSendFailure({
          ...logContext,
          nextRetryAt: resumeAt
        });
        return;
      }

      if (recipientJob.retryCount < MAX_RETRY_ATTEMPTS && retryable) {
        const updated = await markRecipientAttempt({
          jobId,
          status: "RETRYING",
          lastError: message,
          failureCode,
          failureSource: "GMAIL",
          failureDetails
        });
        logGmailSendFailure({
          ...logContext,
          nextRetryAt: updated.nextRetryAt
        });
        await queues.send.add(
          "send-recipient",
          { jobId },
          {
            jobId: recipientJob.dedupeKey,
            delay: Math.max(1_000, (updated.nextRetryAt?.getTime() ?? Date.now() + 5 * 60_000) - Date.now())
          }
        );
        return;
      }

      if (failureCode === "GMAIL_RATE_LIMITED") {
        const resumeAt = getGmailRetryAfterDate(error, GMAIL_RATE_LIMIT_PAUSE_MS);
        await pauseCampaignRunForSenderLimit({
          runId: recipientJob.campaignRunId,
          jobId,
          message,
          resumeAt,
          failureDetails
        });
        logGmailSendFailure({
          ...logContext,
          nextRetryAt: resumeAt
        });
        return;
      }

      const updated = await markRecipientAttempt({
        jobId,
        status: "FAILED",
        lastError: message,
        failureCode,
        failureSource: "GMAIL",
        failureDetails
      });
      logGmailSendFailure({
        ...logContext,
        nextRetryAt: updated.nextRetryAt
      });
    }
  },
  {
    connection,
    // Bound simultaneous Gmail sends. With per-sender pacing (GMAIL_SENDS_PER_MINUTE)
    // this keeps a single mailbox from bursting concurrent requests, which is what
    // Gmail's rate limiter punishes hardest on large sequences. Was hardcoded to 10.
    concurrency: env.GMAIL_SENDER_CONCURRENCY
  }
);

const webhookWorker = new Worker(
  "webhook",
  async () => {
    return;
  },
  { connection }
);

launchWorker.on("failed", (job, error) => {
  console.error("Launch worker failed", job?.id, error);
});

sendWorker.on("failed", (job, error) => {
  console.error("Send worker failed", job?.id, error);
});

webhookWorker.on("failed", (job, error) => {
  console.error("Webhook worker failed", job?.id, error);
});
