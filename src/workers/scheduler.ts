import { processPendingCampaignWork } from "@/services/campaigns";
import { syncConnectedSenderReplies } from "@/services/replies";
import { runAutomaticSequenceBounceChecks } from "@/services/sequence-bounce-monitor";

let ticking = false;

async function tick() {
  if (ticking) {
    return;
  }

  ticking = true;

  try {
    try {
      await processPendingCampaignWork({
        maxDurationMs: 55_000
      });
      await syncConnectedSenderReplies();
    } catch (error) {
      console.error("[scheduler] Campaign tick failed.", error);
    }

    // Automatic bounce monitoring for running/just-completed sequences — after
    // send work, in its own guard so monitoring and sending never mask each
    // other's failures. The service bounds its own Gmail usage per tick.
    try {
      await runAutomaticSequenceBounceChecks();
    } catch (error) {
      console.error("[scheduler] Automatic sequence bounce monitoring failed.", error);
    }
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
