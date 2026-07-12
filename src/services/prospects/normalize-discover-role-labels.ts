// Pure planner for the Discover role-label normalization repair script. Given
// the raw stored requested-role labels of existing searches, it computes the
// CLEAN canonical labels (casing/whitespace fixes plus high-confidence typo
// corrections toward the generic role dictionary) and reports only the rows that
// actually change. No I/O — the script does the DB reads/writes and hands rows
// here so every branch is unit-testable.
//
// Deliberately conservative and role-only: locations are left untouched (state
// codes like "TX" make blind location casing risky), unrelated roles are never
// rewritten (a typo only snaps within the shared edit budget), and the plan is
// idempotent — normalizing an already-clean label is a no-op.

import { COMMON_ROLE_LABELS } from "@/services/prospects/discover-canonical-labels";
import { canonicalizeLabels } from "@/services/prospects/discover-suggestions";

export type RoleLabelRow = {
  id: string;
  userId: string;
  requestedTitles: string[];
};

export type RoleLabelChange = {
  id: string;
  userId: string;
  before: string[];
  after: string[];
};

export type RoleLabelNormalizationPlan = {
  changes: RoleLabelChange[];
  summary: {
    rowsScanned: number;
    rowsChanged: number;
  };
};

function sameLabels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Compute the normalization plan. A row is a "change" only when its canonical
 * requested titles differ from what is stored. Corrections snap toward the
 * generic role dictionary (plus every row's own labels as trusted context), so
 * a bad-cased or lightly-misspelled role is cleaned while distinct roles are
 * preserved.
 */
export function planDiscoverRoleLabelNormalization(rows: readonly RoleLabelRow[]): RoleLabelNormalizationPlan {
  // Trusted pool = the generic canonical dictionary ONLY. Using the rows' own
  // labels would let a typo match itself (blocking its own correction), so the
  // script snaps only toward the vetted dictionary; everything else is just
  // casing-cleaned. This keeps it conservative and idempotent.
  const known = COMMON_ROLE_LABELS;
  const changes: RoleLabelChange[] = [];
  for (const row of rows) {
    const after = canonicalizeLabels(row.requestedTitles, known);
    if (!sameLabels(row.requestedTitles, after)) {
      changes.push({ id: row.id, userId: row.userId, before: row.requestedTitles, after });
    }
  }
  return {
    changes,
    summary: { rowsScanned: rows.length, rowsChanged: changes.length }
  };
}
