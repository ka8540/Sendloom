import { processPendingCampaignWork } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";

let ticking = false;

async function tick() {
  if (ticking) {
    return;
  }

  ticking = true;

  try {
    await processPendingCampaignWork({
      maxDurationMs: 55_000
    });
    await syncConnectedSenderReplies();
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
