import { Worker, type ConnectionOptions } from "bullmq";

import { prisma } from "@/lib/db";
import { getUserSafeGmailSendError, isGmailDailyLimitError, sendEmail, type EmailAttachment } from "@/lib/provider";
import { queues } from "@/lib/queue";
import { consumeSendWindow, getSendWindowKey } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { classifySendFailure, isRetryableFailure, MAX_RETRY_ATTEMPTS } from "@/lib/retry-policy";
import { enqueueRecipientJobs, markRecipientAttempt, pauseCampaignRunForSenderLimit } from "@/services/campaigns";

const connection = getRedis() as unknown as ConnectionOptions;

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

    if (recipientJob.status === "RETRYING" && recipientJob.nextRetryAt && recipientJob.nextRetryAt > new Date()) {
      return;
    }

    if (recipientJob.campaignRun.status === "PAUSED" || recipientJob.campaignRun.campaign.status === "PAUSED") {
      return;
    }

    try {
      const rateWindow = await consumeSendWindow(
        getSendWindowKey({
          userId: recipientJob.campaignRun.campaign.userId ?? recipientJob.campaignRun.campaign.senderProfile.userId,
          senderProfileId: recipientJob.campaignRun.campaign.senderProfileId
        })
      );
      if (!rateWindow.allowed) {
        await markRecipientAttempt({
          jobId,
          status: "RETRYING",
          lastError: "Rate limit window reached",
          failureCode: "GMAIL_RATE_LIMITED",
          failureSource: "GMAIL"
        });
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
    } catch (error) {
      const message = getUserSafeGmailSendError(error);
      console.error("[worker-send] Delivery failed.", error);
      if (isGmailDailyLimitError(error)) {
        await pauseCampaignRunForSenderLimit({
          runId: recipientJob.campaignRunId,
          jobId,
          message
        });
        return;
      }

      const failureCode = classifySendFailure(error, {
        senderConnected: Boolean(recipientJob.campaignRun.campaign.senderProfile.oauthRefreshToken)
      });

      if (recipientJob.retryCount < MAX_RETRY_ATTEMPTS && isRetryableFailure(failureCode)) {
        await markRecipientAttempt({
          jobId,
          status: "RETRYING",
          lastError: message,
          failureCode,
          failureSource: "GMAIL"
        });
        await queues.send.add(
          "send-recipient",
          { jobId },
          {
            jobId: recipientJob.dedupeKey,
            delay: 5 * 60_000
          }
        );
        return;
      }

      await markRecipientAttempt({
        jobId,
        status: "FAILED",
        lastError: message,
        failureCode,
        failureSource: "GMAIL"
      });
    }
  },
  {
    connection,
    concurrency: 10
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
