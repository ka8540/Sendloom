/**
 * Safely canonicalize legacy Discover role/location labels that have one
 * deterministic correction. Ambiguous or invalid historical text is preserved
 * for audit/history but quarantined by the runtime suggestion boundary.
 *
 *   npx tsx scripts/repair-discover-search-labels.ts --dry-run
 *   npx tsx scripts/repair-discover-search-labels.ts --apply
 *
 * Dry-run is the default. This script imports PrismaClient directly and needs
 * only DATABASE_URL; it intentionally does not load the application env schema.
 */
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

import { validateDiscoverSearchLabel } from "../src/services/prospects/discover-search-label-validation";

const BATCH_SIZE = 200;

export type DiscoverLabelRepairOptions = { apply: boolean };

export type DiscoverLabelRepairStats = {
  rowsScanned: number;
  titleLabelsScanned: number;
  locationLabelsScanned: number;
  canonicalCorrections: number;
  invalidOrIncompleteFound: number;
  ambiguousFound: number;
  historicalValuesQuarantined: number;
  rowsChanged: number;
  failures: number;
};

export type DiscoverLabelRepairRow = {
  id: string;
  status: string;
  requestedTitles: unknown;
  requestedLocations: unknown;
  totalProcessed: number;
  attemptCount: number;
  updatedAt: Date;
};

type FindManyArgs = {
  take: number;
  where: { id?: { gt: string } };
  orderBy: { id: "asc" };
  select: {
    id: true;
    status: true;
    requestedTitles: true;
    requestedLocations: true;
    totalProcessed: true;
    attemptCount: true;
    updatedAt: true;
  };
};

type UpdateManyArgs = {
  where: { id: string; updatedAt: Date };
  data: { requestedTitles?: string[]; requestedLocations?: string[] };
};

export type DiscoverLabelRepairPrisma = {
  prospectSearch: {
    findMany(args: FindManyArgs): Promise<DiscoverLabelRepairRow[]>;
    updateMany(args: UpdateManyArgs): Promise<{ count: number }>;
  };
};

export function parseDiscoverLabelRepairOptions(argv: string[]): DiscoverLabelRepairOptions {
  const allowed = new Set(["--dry-run", "--apply"]);
  if (argv.some((arg) => !allowed.has(arg))) {
    throw new Error("Unsupported option. Use --dry-run or --apply.");
  }
  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }
  return { apply: argv.includes("--apply") };
}

export function discoverLabelDatabaseFingerprint(raw: string | undefined): string {
  if (!raw?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }
  try {
    const url = new URL(raw);
    if (!url.hostname || !["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("unsupported database URL");
    }
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "(none)";
    return `target host=${url.hostname} port=${url.port || "default"} database=${database}`;
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}

export function emptyDiscoverLabelRepairStats(): DiscoverLabelRepairStats {
  return {
    rowsScanned: 0,
    titleLabelsScanned: 0,
    locationLabelsScanned: 0,
    canonicalCorrections: 0,
    invalidOrIncompleteFound: 0,
    ambiguousFound: 0,
    historicalValuesQuarantined: 0,
    rowsChanged: 0,
    failures: 0
  };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value as string[];
}

function repairLabels(
  type: "ROLE" | "LOCATION",
  raw: unknown,
  stats: DiscoverLabelRepairStats
): { value: string[] | null; changed: boolean } {
  const labels = stringArray(raw);
  if (!labels) {
    // A null location list represents no location and is not malformed. Other
    // non-array JSON is left untouched and quarantined from suggestions by the
    // runtime type guard.
    if (!(type === "LOCATION" && raw == null)) {
      stats.invalidOrIncompleteFound += 1;
      stats.historicalValuesQuarantined += 1;
    }
    return { value: null, changed: false };
  }

  if (type === "ROLE") {
    stats.titleLabelsScanned += labels.length;
  } else {
    stats.locationLabelsScanned += labels.length;
  }

  let changed = false;
  const value = labels.map((label) => {
    const result = validateDiscoverSearchLabel({ type, value: label });
    if (result.status === "CORRECTED") {
      stats.canonicalCorrections += 1;
      changed = changed || result.value !== label;
      return result.value;
    }
    if (result.status === "AMBIGUOUS") {
      stats.ambiguousFound += 1;
      stats.historicalValuesQuarantined += 1;
    } else if (result.status === "INVALID") {
      stats.invalidOrIncompleteFound += 1;
      stats.historicalValuesQuarantined += 1;
    }
    return label;
  });

  return { value, changed };
}

/**
 * Keyset-scan every search in bounded batches. Apply writes only safely
 * corrected arrays and guards on updatedAt so concurrent edits are never
 * overwritten. Ambiguous/invalid values remain historically intact.
 */
export async function runDiscoverLabelRepair(
  prisma: DiscoverLabelRepairPrisma,
  options: DiscoverLabelRepairOptions
): Promise<DiscoverLabelRepairStats> {
  const stats = emptyDiscoverLabelRepairStats();
  let after: string | null = null;

  for (;;) {
    const rows = await prisma.prospectSearch.findMany({
      take: BATCH_SIZE,
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        requestedTitles: true,
        requestedLocations: true,
        totalProcessed: true,
        attemptCount: true,
        updatedAt: true
      }
    });
    if (rows.length === 0) {
      break;
    }
    after = rows[rows.length - 1].id;

    for (const row of rows) {
      stats.rowsScanned += 1;
      const titles = repairLabels("ROLE", row.requestedTitles, stats);
      const locations = repairLabels("LOCATION", row.requestedLocations, stats);
      if (!titles.changed && !locations.changed) {
        continue;
      }
      if (!options.apply) {
        continue;
      }

      const data: UpdateManyArgs["data"] = {};
      if (titles.changed && titles.value) {
        data.requestedTitles = titles.value;
      }
      if (locations.changed && locations.value) {
        data.requestedLocations = locations.value;
      }
      try {
        const result = await prisma.prospectSearch.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt },
          data
        });
        stats.rowsChanged += result.count;
      } catch {
        stats.failures += 1;
      }
    }
  }

  return stats;
}

export function formatDiscoverLabelRepairStats(stats: DiscoverLabelRepairStats): string {
  return (Object.entries(stats) as Array<[keyof DiscoverLabelRepairStats, number]>)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

async function main(): Promise<void> {
  const options = parseDiscoverLabelRepairOptions(process.argv.slice(2));
  const target = discoverLabelDatabaseFingerprint(process.env.DATABASE_URL);
  console.info(`[repair-discover-search-labels] mode=${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.info(`[repair-discover-search-labels] ${target}`);

  const prisma = new PrismaClient();
  try {
    const stats = await runDiscoverLabelRepair(prisma as unknown as DiscoverLabelRepairPrisma, options);
    console.info(formatDiscoverLabelRepairStats(stats));
    if (!options.apply) {
      console.info("Dry run complete. No rows were written.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl === import.meta.url) {
  void main().catch(() => {
    // Driver failures may contain connection details; never print raw errors.
    console.error("[repair-discover-search-labels] failed; verify options and database connectivity.");
    process.exitCode = 1;
  });
}
