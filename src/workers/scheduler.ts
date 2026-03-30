import { prisma } from "@/lib/db";
import { queues } from "@/lib/queue";
import { queueRecurringRuns } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";

async function processPendingRetries() {
  const pendingRetries = await prisma.recipientJob.findMany({
    where: {
      status: "RETRYING",
      nextRetryAt: {
        lte: new Date()
      },
      campaignRun: {
        status: {
          in: ["QUEUED", "RUNNING"]
        }
      }
    },
    take: 250
  });

  for (const retryJob of pendingRetries) {
    await queues.send.add(
      "send-recipient",
      {
        jobId: retryJob.id
      },
      {
        jobId: retryJob.dedupeKey
      }
    );
  }
}

async function processCompletedRuns() {
  const activeRuns = await prisma.campaignRun.findMany({
    where: {
      status: "RUNNING"
    },
    include: {
      recipientJobs: {
        select: {
          status: true
        }
      }
    }
  });

  for (const run of activeRuns) {
    const hasPending = run.recipientJobs.some((job) => ["PENDING", "RETRYING"].includes(job.status));
    if (!hasPending) {
      await prisma.campaignRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date()
        }
      });

      await prisma.campaign.update({
        where: { id: run.campaignId },
        data: {
          status: "COMPLETED"
        }
      });
    }
  }
}

async function tick() {
  await syncConnectedSenderReplies();
  await queueRecurringRuns();
  await processPendingRetries();
  await processCompletedRuns();
}

async function loop() {
  await tick();
  setInterval(() => {
    void tick();
  }, 60_000);
}

void loop();
