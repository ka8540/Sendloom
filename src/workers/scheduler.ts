import { processPendingCampaignWork } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";

let ticking = false;

async function tick() {
  if (ticking) {
    return;
  }

  ticking = true;

  try {
    const replySync = await syncConnectedSenderReplies();
    const result = await processPendingCampaignWork({
      maxDurationMs: 55_000
    });

    if (
      result.dueCampaignsFound > 0 ||
      result.runsCreated > 0 ||
      result.runsProcessed > 0 ||
      result.recipientJobsProcessed > 0 ||
      result.errors.length > 0 ||
      replySync.repliesStored > 0 ||
      replySync.sendersFailed > 0
    ) {
      console.log("[scheduler] Campaign tick complete.", {
        dueCampaignsFound: result.dueCampaignsFound,
        runsCreated: result.runsCreated,
        runsProcessed: result.runsProcessed,
        recipientJobsProcessed: result.recipientJobsProcessed,
        repliesSynced: replySync.repliesStored,
        errors: result.errors.length + replySync.sendersFailed
      });
    }
  } catch (error) {
    console.error("[scheduler] Campaign tick failed.", error);
  } finally {
    ticking = false;
  }
}

async function loop() {
  await tick();
  setInterval(() => {
    void tick();
  }, 60_000);
}

void loop();
