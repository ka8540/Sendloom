/**
 * Reclassify recipient jobs whose stored evidence proves the recipient
 * ADDRESS was invalid (Gmail "Address not found", "550 5.1.1 user unknown",
 * DSN hard-bounce metadata, or an existing invalid-address suppression) but
 * whose status still hides that from the sequence rollups: generic FAILED
 * rows, legacy BOUNCED rows, and falsely-delivered SENT/OPENED rows (bounce
 * confirmed after the send; possibly flipped back by a false pixel "open").
 * Eligible rows become the Skipped (SUPPRESSED) disposition, gain an
 * INVALID_EMAIL suppression so future sends skip the address before calling
 * Gmail, and every touched run's rollup counters are resynced.
 *
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --dry-run
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply --user <userId>
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply --campaign <campaignId>
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply --campaign <campaignId> --sync-gmail
 *
 * Dry-run by default; pass --apply to write. Idempotent — reclassified rows
 * leave the scanned filters, and suppressions are upserted per (user, email).
 * SENT/OPENED rows convert only on strong evidence (DSN hard-bounce metadata
 * or a confirmed suppression) and never when the recipient replied. Detection
 * is signature-based only: no company, domain, or recipient is special-cased.
 * Prints ids, categories, and counts — never message bodies.
 *
 * --sync-gmail additionally reads the targeted senders' Gmail delivery-status
 * notifications (bounded backfill + incremental sync — the same pipeline as
 * the in-app "Check bounces" action) before reclassifying, so bounces not yet
 * ingested are picked up. Because that sync writes as it processes, it only
 * runs with --apply; dry-run reports stored evidence only. Never sends email.
 */
import { prisma } from "@/lib/db";
import { runRecentBounceBackfill, runSequenceBounceScan, syncSenderBounces } from "@/services/bounces";
import { reclassifyInvalidRecipientJobs } from "@/services/invalid-recipient-reclassification";

function parseArgs(argv: string[]): {
  apply: boolean;
  syncGmail: boolean;
  userId?: string;
  campaignId?: string;
  limit?: number;
} {
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const limitRaw = readValue("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  return {
    apply: argv.includes("--apply"),
    syncGmail: argv.includes("--sync-gmail"),
    userId: readValue("--user"),
    campaignId: readValue("--campaign"),
    limit: Number.isFinite(limit) && limit ? limit : undefined
  };
}

/** Distinct Gmail senders behind the targeted campaigns (exact scope only). */
async function findTargetSenderIds(args: { userId?: string; campaignId?: string }): Promise<string[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      ...(args.campaignId ? { id: args.campaignId } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      senderProfile: { provider: "google_oauth" }
    },
    select: { senderProfileId: true },
    take: 500
  });
  return [...new Set(campaigns.map((campaign) => campaign.senderProfileId))];
}

async function findTargetCampaigns(args: { userId?: string; campaignId?: string }) {
  return prisma.campaign.findMany({
    where: {
      ...(args.campaignId ? { id: args.campaignId } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      senderProfile: { provider: "google_oauth" }
    },
    select: { id: true, userId: true, senderProfileId: true },
    take: 500
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.syncGmail && !args.apply) {
    console.info(
      "[reclassify-invalid-recipients] --sync-gmail ingests bounce notifications as it reads, so it requires --apply. Dry run uses stored evidence only."
    );
  } else if (args.syncGmail) {
    if (args.campaignId) {
      const campaigns = await findTargetCampaigns(args);
      console.info(`[reclassify-invalid-recipients] Syncing Gmail bounces for ${campaigns.length} campaign(s)…`);
      for (const campaign of campaigns) {
        if (!campaign.userId) {
          console.info(`[reclassify-invalid-recipients] ${campaign.id}: skipped (campaign has no user).`);
          continue;
        }
        const scan = await runSequenceBounceScan({
          campaignId: campaign.id,
          userId: campaign.userId,
          senderId: campaign.senderProfileId
        });
        console.info(
          `[reclassify-invalid-recipients] ${campaign.id}: checked ${scan.checkedMessages} message(s), ` +
            `${scan.bouncesParsed} bounce(s) parsed, ${scan.processedBounces} matched, ` +
            `${scan.permanentFailures} permanent failure(s)` +
            `${scan.skipped ? ` (sync skipped: ${scan.skipped})` : ""}`
        );
      }
    } else {
      const senderIds = await findTargetSenderIds(args);
      console.info(`[reclassify-invalid-recipients] Syncing Gmail bounces for ${senderIds.length} sender(s)…`);
      for (const senderId of senderIds) {
        const backfill = await runRecentBounceBackfill(senderId);
        const sync = await syncSenderBounces(senderId, { force: true });
        console.info(
          `[reclassify-invalid-recipients] ${senderId}: checked ${backfill.checkedMessages + sync.checkedMessages} message(s), ` +
            `${backfill.bouncesParsed + sync.bouncesParsed} bounce(s) parsed, ` +
            `${sync.processedBounces + backfill.processedBounces} matched, ` +
            `${backfill.permanentFailures + sync.permanentFailures} permanent failure(s)` +
            `${sync.skipped ? ` (sync skipped: ${sync.skipped})` : ""}`
        );
      }
    }
  }

  const result = await reclassifyInvalidRecipientJobs(args);

  console.info(
    `[reclassify-invalid-recipients] ${args.apply ? "APPLY" : "DRY RUN"} — scanned ${result.scanned} job(s) (FAILED/BOUNCED/SENT/OPENED), ${result.candidates.length} with invalid-recipient evidence.`
  );
  const byPreviousStatus = new Map<string, number>();
  for (const candidate of result.candidates) {
    byPreviousStatus.set(candidate.previousStatus, (byPreviousStatus.get(candidate.previousStatus) ?? 0) + 1);
    console.info(
      `[reclassify-invalid-recipients] ${candidate.jobId}: ${candidate.previousStatus} → SUPPRESSED, ${candidate.evidence.failureCategory}` +
        `${candidate.evidence.enhancedStatusCode ? ` (${candidate.evidence.enhancedStatusCode})` : ""}` +
        ` via ${candidate.evidence.evidenceSource}`
    );
  }
  for (const [status, count] of byPreviousStatus) {
    console.info(`[reclassify-invalid-recipients] ${status}: ${count} candidate(s)`);
  }
  if (args.apply) {
    console.info(
      `[reclassify-invalid-recipients] Reclassified ${result.reclassifiedCount} row(s), recorded ${result.suppressionsRecordedCount} suppression(s), recomputed stats for ${result.runsResyncedCount} run(s).`
    );
  } else {
    console.info("[reclassify-invalid-recipients] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error(
      "[reclassify-invalid-recipients] Failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
