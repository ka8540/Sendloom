import { Worker, type ConnectionOptions } from "bullmq";

import { prisma } from "@/lib/db";
import { sendEmail, type EmailAttachment } from "@/lib/provider";
import { queues } from "@/lib/queue";
import { consumeSendWindow } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { enqueueRecipientJobs, markRecipientAttempt } from "@/services/campaigns";

const connection = getRedis() as unknown as ConnectionOptions;

function isRetriableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate|timeout|temporar/i.test(message);
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

    try {
      const rateWindow = await consumeSendWindow();
      if (!rateWindow.allowed) {
        await markRecipientAttempt({
          jobId,
          status: "RETRYING",
          lastError: "Rate limit window reached"
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
      const message = error instanceof Error ? error.message : "Unknown provider error";
      if (recipientJob.retryCount < 5 && isRetriableError(error)) {
        await markRecipientAttempt({
          jobId,
          status: "RETRYING",
          lastError: message
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
        lastError: message
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

console.log("Sendloom workers started.");
