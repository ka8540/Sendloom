/**
 * Promote historical, provider-provenance Discover people into the sanitized
 * shared cache. Dry-run is the default; writes require an explicit --apply.
 *
 *   npx tsx scripts/backfill-discover-shared-cache.ts --dry-run
 *   npx tsx scripts/backfill-discover-shared-cache.ts --dry-run --batch-size 100 --limit 1000
 *   npx tsx scripts/backfill-discover-shared-cache.ts --apply --batch-size 100 --limit 1000
 *
 * This script is PostgreSQL-only and never invokes Apify, OpenAI, web search,
 * or email providers. Its output is aggregate-only and contains no PII.
 */
import { pathToFileURL } from "node:url";

import { prisma } from "@/lib/db";
import {
  PrismaDiscoverLegacyCacheBackfillStore,
  runDiscoverLegacyCacheBackfill,
  type DiscoverLegacyCacheBackfillOptions,
  type DiscoverLegacyCacheBackfillStats
} from "@/services/prospects/discover-legacy-cache-backfill";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export function parseDiscoverSharedCacheBackfillArgs(
  argv: readonly string[]
): DiscoverLegacyCacheBackfillOptions {
  const allowedFlags = new Set(["--dry-run", "--apply", "--batch-size", "--limit"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!allowedFlags.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (argument === "--batch-size" || argument === "--limit") {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`${argument} must be followed by a positive integer.`);
      }
    }
  }

  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }
  const positiveIntegerAfter = (flag: string, fallback: number | null): number | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return fallback;
    const parsed = Number(argv[index + 1]);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${flag} must be a positive integer.`);
    }
    return parsed;
  };
  const batchSize = positiveIntegerAfter("--batch-size", DEFAULT_BATCH_SIZE)!;
  if (batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size cannot exceed ${MAX_BATCH_SIZE}.`);
  }
  return { apply, batchSize, limit: positiveIntegerAfter("--limit", null) };
}

export function printDiscoverSharedCacheBackfillStats(stats: DiscoverLegacyCacheBackfillStats): void {
  const prefix = "[discover-shared-cache-backfill]";
  console.info(`${prefix} mode=${stats.mode}`);
  console.info(`${prefix} historicalSearchesScanned=${stats.historicalSearchesScanned}`);
  console.info(`${prefix} providerEligibleSearches=${stats.providerEligibleSearches}`);
  console.info(`${prefix} eligiblePeopleCount=${stats.eligiblePeopleCount}`);
  console.info(`${prefix} uniquePublicPeopleCount=${stats.uniquePublicPeopleCount}`);
  console.info(`${prefix} cacheEntriesToCreate=${stats.cacheEntriesToCreate}`);
  console.info(`${prefix} cacheEntriesToMerge=${stats.cacheEntriesToMerge}`);
  console.info(`${prefix} peopleToInsert=${stats.peopleToInsert}`);
  console.info(`${prefix} duplicatePeopleSkipped=${stats.duplicatePeopleSkipped}`);
  console.info(`${prefix} skippedNoProviderProvenance=${stats.skippedNoProviderProvenance}`);
  console.info(`${prefix} skippedNoStrongCompanyIdentity=${stats.skippedNoStrongCompanyIdentity}`);
  console.info(`${prefix} skippedExpired=${stats.skippedExpired}`);
  console.info(`${prefix} skippedNoPeople=${stats.skippedNoPeople}`);
  console.info(`${prefix} cacheVersion=${stats.cacheVersion}`);
  console.info(`${prefix} cacheTtlDays=${stats.cacheTtlDays}`);
}

async function main(): Promise<void> {
  const options = parseDiscoverSharedCacheBackfillArgs(process.argv.slice(2));
  const stats = await runDiscoverLegacyCacheBackfill({
    store: new PrismaDiscoverLegacyCacheBackfillStore(prisma),
    options
  });
  printDiscoverSharedCacheBackfillStats(stats);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main()
    .catch(() => {
      // Deliberately omit the underlying error: DB/provider configuration text
      // can contain credentials and aggregate-only output is a hard guarantee.
      console.error("[discover-shared-cache-backfill] failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
