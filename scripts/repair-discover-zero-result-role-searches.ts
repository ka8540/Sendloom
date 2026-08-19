/**
 * Repair legacy Discover searches stored as READY even though they processed
 * no people.
 *
 *   npx tsx scripts/repair-discover-zero-result-role-searches.ts --dry-run
 *   npx tsx scripts/repair-discover-zero-result-role-searches.ts --apply
 *
 * Safety properties:
 *  - dry-run is the default and performs zero writes;
 *  - only READY rows with totalProcessed <= 0 are candidates;
 *  - existing NO_RESULTS attempts remain intact for retry/history semantics;
 *  - positive READY rows, people, allocations, caches, provider metadata, and
 *    every unrelated field are untouched;
 *  - updates are idempotent and guarded by the same predicate at write time;
 *  - output contains aggregate counts plus a credential-free DB fingerprint.
 *
 * This script intentionally imports PrismaClient directly. It does not load the
 * application-wide env validator, so the only required secret is DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

const BATCH_SIZE = 200;

export type ZeroResultRepairOptions = { apply: boolean };

export type ZeroResultRepairStats = {
  rowsScanned: number;
  readyZeroCandidates: number;
  changedToNoResults: number;
  noResultsAlreadyCorrect: number;
  readyWithPeopleSkipped: number;
  failures: number;
};

export type ZeroResultRepairRow = {
  id: string;
  status: string;
  totalProcessed: number;
};

type FindManyArgs = {
  take: number;
  where: {
    status: { in: string[] };
    id?: { gt: string };
  };
  orderBy: { id: "asc" };
  select: { id: true; status: true; totalProcessed: true };
};

type UpdateManyArgs = {
  where: {
    id: string;
    status: "READY";
    totalProcessed: { lte: number };
  };
  data: { status: "NO_RESULTS" };
};

export type ZeroResultRepairPrisma = {
  prospectSearch: {
    findMany(args: FindManyArgs): Promise<ZeroResultRepairRow[]>;
    updateMany(args: UpdateManyArgs): Promise<{ count: number }>;
  };
};

export function parseZeroResultRepairOptions(argv: string[]): ZeroResultRepairOptions {
  const allowed = new Set(["--dry-run", "--apply"]);
  if (argv.some((arg) => !allowed.has(arg))) {
    throw new Error("Unsupported option. Use --dry-run or --apply.");
  }
  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }
  return { apply: argv.includes("--apply") };
}

/** Return only the safe target fields an operator needs to verify. */
export function databaseFingerprint(raw: string | undefined): string {
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

export function emptyZeroResultRepairStats(): ZeroResultRepairStats {
  return {
    rowsScanned: 0,
    readyZeroCandidates: 0,
    changedToNoResults: 0,
    noResultsAlreadyCorrect: 0,
    readyWithPeopleSkipped: 0,
    failures: 0
  };
}

/**
 * Scan relevant rows in bounded keyset batches. The guarded updateMany makes an
 * apply safe under concurrency: if another worker already changed the row, the
 * update count is zero and no unrelated state can be overwritten.
 */
export async function runZeroResultRepair(
  prisma: ZeroResultRepairPrisma,
  options: ZeroResultRepairOptions
): Promise<ZeroResultRepairStats> {
  const stats = emptyZeroResultRepairStats();
  let after: string | null = null;

  for (;;) {
    const rows = await prisma.prospectSearch.findMany({
      take: BATCH_SIZE,
      where: {
        status: { in: ["READY", "NO_RESULTS"] },
        ...(after ? { id: { gt: after } } : {})
      },
      orderBy: { id: "asc" },
      select: { id: true, status: true, totalProcessed: true }
    });
    if (rows.length === 0) {
      break;
    }
    after = rows[rows.length - 1].id;

    for (const row of rows) {
      stats.rowsScanned += 1;
      if (row.status === "NO_RESULTS") {
        stats.noResultsAlreadyCorrect += 1;
        continue;
      }
      if (row.status !== "READY" || row.totalProcessed > 0) {
        stats.readyWithPeopleSkipped += 1;
        continue;
      }

      stats.readyZeroCandidates += 1;
      if (!options.apply) {
        continue;
      }

      try {
        const result = await prisma.prospectSearch.updateMany({
          where: { id: row.id, status: "READY", totalProcessed: { lte: 0 } },
          data: { status: "NO_RESULTS" }
        });
        stats.changedToNoResults += result.count;
      } catch {
        stats.failures += 1;
      }
    }
  }

  return stats;
}

export function formatZeroResultRepairStats(stats: ZeroResultRepairStats): string {
  return (Object.entries(stats) as Array<[keyof ZeroResultRepairStats, number]>)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

async function main(): Promise<void> {
  const options = parseZeroResultRepairOptions(process.argv.slice(2));
  const target = databaseFingerprint(process.env.DATABASE_URL);
  console.info(`[repair-discover-zero-result-role-searches] mode=${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.info(`[repair-discover-zero-result-role-searches] ${target}`);

  const prisma = new PrismaClient();
  try {
    const stats = await runZeroResultRepair(prisma as unknown as ZeroResultRepairPrisma, options);
    console.info(formatZeroResultRepairStats(stats));
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
    // Never echo the raw error: driver errors may include connection details.
    console.error("[repair-discover-zero-result-role-searches] failed; verify options and database connectivity.");
    process.exitCode = 1;
  });
}
