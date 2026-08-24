/**
 * Populate title-level role semantics from existing reusable Discover titles.
 *
 *   npx tsx scripts/backfill-discover-role-semantics.ts --dry-run
 *   npx tsx scripts/backfill-discover-role-semantics.ts --apply --batch-size 100 --limit 1000
 *
 * Dry run is the default. Output is aggregate-only: this script never prints a
 * person, email, profile URL, user id, provider payload, or database secret.
 * It only inserts missing ProspectRoleSemantic rows and never rewrites people,
 * cache people, searches, allocations, or title classifications.
 */
import { pathToFileURL } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createDiscoverRoleIntelligenceService } from "@/services/prospects/discover-role-intelligence-service";
import { createAiBudget, OpenAiProspectClient } from "@/services/prospects/prospect-ai";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import { PrismaRoleSemanticStore } from "@/services/prospects/role-semantic-store";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

export type BackfillOptions = {
  apply: boolean;
  batchSize: number;
  limit: number | null;
};

export type BackfillStats = {
  distinctTitleCount: number;
  alreadyEmbeddedCount: number;
  missingSemanticCount: number;
  invalidOrEmptyTitleCount: number;
  estimatedEmbeddingBatches: number;
  embeddedCount: number;
  failedBatchCount: number;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillOptions {
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }
  const numberAfter = (flag: string, fallback: number | null): number | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return fallback;
    const parsed = Number(argv[index + 1]);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
    return parsed;
  };
  const batchSize = numberAfter("--batch-size", 100)!;
  if (batchSize > 500) throw new Error("--batch-size cannot exceed 500.");
  return { apply, batchSize, limit: numberAfter("--limit", null) };
}

export async function runBackfillPlan(input: {
  titles: readonly string[];
  existingTitles: ReadonlySet<string>;
  invalidOrEmptyTitleCount: number;
  options: BackfillOptions;
  persistBatch: (titles: readonly string[]) => Promise<{ created: number; failed: boolean }>;
}): Promise<BackfillStats> {
  const normalized = Array.from(
    new Set(input.titles.map((title) => normalizeTitle(title)).filter(Boolean))
  ).sort();
  const selected = input.options.limit ? normalized.slice(0, input.options.limit) : normalized;
  const missing = selected.filter((title) => !input.existingTitles.has(title));
  const stats: BackfillStats = {
    distinctTitleCount: selected.length,
    alreadyEmbeddedCount: selected.length - missing.length,
    missingSemanticCount: missing.length,
    invalidOrEmptyTitleCount: input.invalidOrEmptyTitleCount,
    estimatedEmbeddingBatches: Math.ceil(missing.length / input.options.batchSize),
    embeddedCount: 0,
    failedBatchCount: 0
  };
  if (!input.options.apply) return stats;

  for (let offset = 0; offset < missing.length; offset += input.options.batchSize) {
    const result = await input.persistBatch(missing.slice(offset, offset + input.options.batchSize));
    stats.embeddedCount += result.created;
    if (result.failed) stats.failedBatchCount += 1;
  }
  return stats;
}

async function loadTitleSource(client: PrismaClient): Promise<{ titles: string[]; invalidCount: number }> {
  const [cacheRows, classificationRows, invalidCount] = await Promise.all([
    client.discoverSearchCachePerson.findMany({
      where: { normalizedTitle: { not: null } },
      distinct: ["normalizedTitle"],
      select: { normalizedTitle: true }
    }),
    client.prospectTitleClassification.findMany({
      distinct: ["normalizedTitle"],
      select: { normalizedTitle: true }
    }),
    client.discoverSearchCachePerson.count({
      where: { OR: [{ normalizedTitle: null }, { normalizedTitle: "" }] }
    })
  ]);
  return {
    titles: [
      ...cacheRows.map((row) => row.normalizedTitle ?? ""),
      ...classificationRows.map((row) => row.normalizedTitle)
    ],
    invalidCount
  };
}

function printStats(stats: BackfillStats, options: BackfillOptions): void {
  console.info(`[discover-role-backfill] mode=${options.apply ? "APPLY" : "DRY_RUN"}`);
  console.info(`[discover-role-backfill] distinctTitleCount=${stats.distinctTitleCount}`);
  console.info(`[discover-role-backfill] alreadyEmbeddedCount=${stats.alreadyEmbeddedCount}`);
  console.info(`[discover-role-backfill] missingSemanticCount=${stats.missingSemanticCount}`);
  console.info(`[discover-role-backfill] invalidOrEmptyTitleCount=${stats.invalidOrEmptyTitleCount}`);
  console.info(`[discover-role-backfill] estimatedEmbeddingBatches=${stats.estimatedEmbeddingBatches}`);
  console.info(`[discover-role-backfill] embeddingModel=${env.DISCOVER_ROLE_EMBEDDING_MODEL}`);
  console.info(`[discover-role-backfill] embeddingDimensions=${env.DISCOVER_ROLE_EMBEDDING_DIMENSIONS}`);
  console.info(`[discover-role-backfill] semanticVersion=${env.DISCOVER_ROLE_SEMANTIC_VERSION}`);
  if (options.apply) {
    console.info(`[discover-role-backfill] embeddedCount=${stats.embeddedCount}`);
    console.info(`[discover-role-backfill] failedBatchCount=${stats.failedBatchCount}`);
  }
}

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));
  const source = await loadTitleSource(prisma);
  const selectedTitles = Array.from(new Set(source.titles.map((title) => normalizeTitle(title)).filter(Boolean)));
  const store = new PrismaRoleSemanticStore(prisma);
  const existing = new Set<string>();
  for (let offset = 0; offset < selectedTitles.length; offset += options.batchSize) {
    const rows = await store.findByTitles(selectedTitles.slice(offset, offset + options.batchSize), {
      embeddingModel: env.DISCOVER_ROLE_EMBEDDING_MODEL,
      embeddingDimensions: env.DISCOVER_ROLE_EMBEDDING_DIMENSIONS,
      semanticVersion: env.DISCOVER_ROLE_SEMANTIC_VERSION
    });
    for (const title of rows.keys()) existing.add(title);
  }

  const ai = new OpenAiProspectClient();
  const classifier = new RoleClassificationService(prisma, ai);
  // Backfill is allowed while application behavior remains feature-flagged off.
  const intelligence = createDiscoverRoleIntelligenceService(prisma, classifier, { enabled: true });
  const stats = await runBackfillPlan({
    titles: selectedTitles,
    existingTitles: existing,
    invalidOrEmptyTitleCount: source.invalidCount,
    options,
    persistBatch: async (titles) => {
      const result = await intelligence.persistTitleKnowledge(titles, { budget: createAiBudget() });
      return { created: result.created, failed: result.failed };
    }
  });
  printStats(stats, options);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main()
    .catch((error) => {
      console.error("[discover-role-backfill] failed", error instanceof Error ? error.message : "Unknown error");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
