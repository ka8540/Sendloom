/**
 * Reclassify recipient jobs stuck as generic FAILED whose stored evidence
 * proves the recipient ADDRESS was invalid (Gmail "Address not found",
 * "550 5.1.1 user unknown", DSN hard-bounce metadata, or an existing
 * invalid-address suppression). Eligible rows become the Skipped (SUPPRESSED)
 * disposition and gain an INVALID_EMAIL suppression so future sends skip the
 * address before calling Gmail.
 *
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --dry-run
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply --user <userId>
 *   npx tsx scripts/reclassify-invalid-recipient-bounces.ts --apply --campaign <campaignId>
 *
 * Dry-run by default; pass --apply to write. Idempotent — reclassified rows
 * leave the FAILED filter, and suppressions are upserted per (user, email).
 * Detection is signature-based only: no company, domain, or recipient is
 * special-cased. Prints ids, categories, and counts — never message bodies.
 */
import { prisma } from "@/lib/db";
import { reclassifyInvalidRecipientJobs } from "@/services/invalid-recipient-reclassification";

function parseArgs(argv: string[]): { apply: boolean; userId?: string; campaignId?: string; limit?: number } {
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const limitRaw = readValue("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  return {
    apply: argv.includes("--apply"),
    userId: readValue("--user"),
    campaignId: readValue("--campaign"),
    limit: Number.isFinite(limit) && limit ? limit : undefined
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await reclassifyInvalidRecipientJobs(args);

  console.info(
    `[reclassify-invalid-recipients] ${args.apply ? "APPLY" : "DRY RUN"} — scanned ${result.scanned} FAILED job(s), ${result.candidates.length} with invalid-recipient evidence.`
  );
  for (const candidate of result.candidates) {
    console.info(
      `[reclassify-invalid-recipients] ${candidate.jobId}: ${candidate.evidence.failureCategory}` +
        `${candidate.evidence.enhancedStatusCode ? ` (${candidate.evidence.enhancedStatusCode})` : ""}` +
        ` via ${candidate.evidence.evidenceSource}`
    );
  }
  if (args.apply) {
    console.info(
      `[reclassify-invalid-recipients] Reclassified ${result.reclassifiedCount} job(s), recorded ${result.suppressionsRecordedCount} suppression(s).`
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
