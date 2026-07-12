/**
 * Normalize existing Discover requested-role labels to clean canonical casing +
 * high-confidence typo corrections.
 *
 *   npx tsx scripts/normalize-discover-role-labels.ts             # dry run (default)
 *   npx tsx scripts/normalize-discover-role-labels.ts --dry-run   # explicit dry run
 *   npx tsx scripts/normalize-discover-role-labels.ts --apply     # write changes
 *   npx tsx scripts/normalize-discover-role-labels.ts --apply --user <userId>
 *
 * Older Discover searches may have stored role labels with broken casing or a
 * small typo (e.g. "SOftware Enigneer"). This rewrites each affected search's
 * requestedTitles to the clean canonical label ("Software Engineer"):
 *
 *   - casing/whitespace is always cleaned (title case, acronyms preserved);
 *   - a near-miss typo snaps ONLY toward the generic canonical role dictionary,
 *     within the same conservative edit budget the UI correction uses;
 *   - unrelated / custom roles are left untouched (just casing-cleaned);
 *   - locations are intentionally NOT touched (state codes like "TX" make blind
 *     location casing unsafe);
 *   - company names are never hardcoded and never rewritten.
 *
 * Global by default (all users), or scope with --user. Idempotent: a second
 * --apply run finds nothing to change. Dry run by default; prints before/after
 * examples and a summary, and only writes with --apply.
 */
import { prisma } from "@/lib/db";
import {
  planDiscoverRoleLabelNormalization,
  type RoleLabelRow
} from "@/services/prospects/normalize-discover-role-labels";

const EXAMPLE_LIMIT = 25;

function parseArgs(argv: string[]): { apply: boolean; userId: string | null } {
  const userIndex = argv.indexOf("--user");
  return {
    apply: argv.includes("--apply"),
    userId: userIndex >= 0 ? (argv[userIndex + 1] ?? "").trim() || null : null
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function loadRows(userId: string | null): Promise<RoleLabelRow[]> {
  const rows = await prisma.prospectSearch.findMany({
    where: { ...(userId ? { userId } : {}) },
    select: { id: true, userId: true, requestedTitles: true }
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    requestedTitles: asStringArray(row.requestedTitles)
  }));
}

async function main(): Promise<void> {
  const { apply, userId } = parseArgs(process.argv.slice(2));
  console.info(
    `[normalize-role-labels] ${apply ? "APPLY" : "DRY RUN"}${userId ? ` for user ${userId}` : " (all users)"}.`
  );

  const rows = await loadRows(userId);
  const { changes, summary } = planDiscoverRoleLabelNormalization(rows);

  for (const change of changes.slice(0, EXAMPLE_LIMIT)) {
    console.info(
      `[normalize-role-labels] search ${change.id}: ` +
        `[${change.before.join(", ")}] -> [${change.after.join(", ")}]`
    );
  }
  if (changes.length > EXAMPLE_LIMIT) {
    console.info(`[normalize-role-labels] …and ${changes.length - EXAMPLE_LIMIT} more.`);
  }

  if (apply) {
    for (const change of changes) {
      await prisma.prospectSearch.update({
        where: { id: change.id },
        data: { requestedTitles: change.after }
      });
    }
  }

  console.info(
    `[normalize-role-labels] Summary: ${summary.rowsScanned} search(es) scanned, ` +
      `${summary.rowsChanged} ${apply ? "normalized" : "to normalize"}.`
  );
  if (!apply) {
    console.info("[normalize-role-labels] Dry run only — re-run with --apply to write.");
  }
}

main()
  .catch((error) => {
    console.error("[normalize-role-labels] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
