// Discover search suggestions: pure ranking + conservative typo correction over
// the user's OWN known company / role / location values. No I/O, no AI, no
// provider calls — this only orders and lightly corrects strings the caller has
// already fetched from the user's Discover history/database. The GraphQL
// resolver (server) builds entries from Prisma rows and calls rankSuggestions;
// the suggestion input component (client) reuses the comma-token helpers. Both
// import this module, so it must stay framework-agnostic and dependency-free
// beyond the shared normalization fold.
//
// Matching is CONSERVATIVE and never maps one distinct value onto another:
//   - "Software Engineer" and "Data Engineer" stay distinct,
//   - "Recruiter" and "Recruiting Manager" stay distinct,
//   - "India" and "Indiana" stay distinct,
//   - "United States" and "United Kingdom" stay distinct.
// A correction is only offered for a genuine near-miss typo of a known value
// when nothing the user typed directly matches anything.

import { normalizeRoleGroupToken } from "@/services/prospects/discover-role-group-key";

export const DEFAULT_SUGGESTION_LIMIT = 8;

// Corrections are deliberately hard to trigger: the query must be at least this
// long, the edit distance must stay within a length-scaled budget, and never
// exceed the absolute cap. Together these stop short/unrelated words from being
// "corrected" into something the user never meant.
const CORRECTION_MIN_QUERY_LENGTH = 4;
const CORRECTION_MAX_DISTANCE = 5;

export type SuggestionKind = "match" | "correction";

/**
 * One known value the user could be typing toward. `value` is inserted verbatim
 * when chosen (original casing preserved); the *Keys drive matching. Callers
 * pass RAW strings — this module normalizes them with the shared role-group fold
 * so casing / whitespace / glyph variants never matter.
 */
export type SuggestionEntry = {
  /** The original-cased string inserted when this suggestion is selected. */
  value: string;
  /** Muted secondary line (e.g. a company's domain). */
  detail?: string | null;
  /** Optional usage frequency (e.g. how many searches used this role). */
  count?: number | null;
  /** Company dedupe hints, preserved so selection can keep backend identity. */
  companyId?: string | null;
  canonicalKey?: string | null;
  /**
   * Every raw string this entry can be matched against by exact / prefix /
   * word-prefix / substring (e.g. a company's name AND its domain). Defaults to
   * [value] when omitted.
   */
  matchKeys?: string[];
  /**
   * Raw strings eligible for typo correction (edit distance). Domains are
   * intentionally excluded here — "Did you mean stripe.com?" reads wrong —
   * so this defaults to [value] unless the caller narrows it.
   */
  correctionKeys?: string[];
  /**
   * Tie-breaker when two entries match at the same rank: higher wins. A resolved
   * company (with a domain + id) can outrank a raw typed company string, and a
   * current-company role can outrank a broader one.
   */
  priority?: number;
};

/** A single ranked row returned to the API / UI. */
export type RankedSuggestion = {
  value: string;
  detail: string | null;
  count: number | null;
  companyId: string | null;
  canonicalKey: string | null;
  kind: SuggestionKind;
};

export type RankSuggestionsResult = {
  /** Direct matches, best first. Never includes the correction. */
  matches: RankedSuggestion[];
  /** A single "Did you mean …" near-miss, or null. */
  correction: RankedSuggestion | null;
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedMatchKeys(entry: SuggestionEntry): string[] {
  const raw = entry.matchKeys && entry.matchKeys.length > 0 ? entry.matchKeys : [entry.value];
  return unique(raw.map((key) => normalizeRoleGroupToken(key)));
}

function normalizedCorrectionKeys(entry: SuggestionEntry): string[] {
  const raw = entry.correctionKeys && entry.correctionKeys.length > 0 ? entry.correctionKeys : [entry.value];
  return unique(raw.map((key) => normalizeRoleGroupToken(key)));
}

/** True when any whitespace-delimited token of `haystack` begins with `needle`. */
function wordStartsWith(haystack: string, needle: string): boolean {
  return haystack.split(" ").some((token) => token.startsWith(needle));
}

// Match ranks (lower is better): exact, prefix, word-prefix, substring. A
// rank <= 1 (exact/whole-string prefix) is a "strong" match that suppresses any
// typo correction — the user is clearly typing a known value already.
const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_WORD_PREFIX = 2;
const RANK_SUBSTRING = 3;

function bestMatchRank(matchKeys: string[], query: string): number | null {
  let best: number | null = null;
  for (const key of matchKeys) {
    let rank: number;
    if (key === query) {
      rank = RANK_EXACT;
    } else if (key.startsWith(query)) {
      rank = RANK_PREFIX;
    } else if (wordStartsWith(key, query)) {
      rank = RANK_WORD_PREFIX;
    } else if (key.includes(query)) {
      rank = RANK_SUBSTRING;
    } else {
      continue;
    }
    if (best === null || rank < best) {
      best = rank;
    }
  }
  return best;
}

/**
 * Classic Levenshtein edit distance (insert / delete / substitute), bounded by
 * `max`: once every cell in a row exceeds `max` the strings are already too far
 * apart to matter, so we bail with max + 1. Small strings only — this never runs
 * on anything longer than a job title / location label.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }
    if (rowMin > max) {
      return max + 1;
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

/**
 * The largest edit distance still treated as a typo for a pair of tokens: a
 * length-scaled budget (¼ of the longer token) with a floor of 1 and the
 * absolute cap. Longer labels tolerate slightly more noise ("softwere
 * engineering" → "software engineer"); short labels almost none, so unrelated
 * short words are never "corrected" into each other.
 */
function correctionBudget(query: string, candidate: string): number {
  const longer = Math.max(query.length, candidate.length);
  return Math.min(CORRECTION_MAX_DISTANCE, Math.max(1, Math.floor(longer / 4)));
}

/**
 * Rank the user's known values against what they typed and, only when nothing
 * directly matches, offer at most one conservative typo correction.
 *
 * Ordering: exact → whole-string prefix → word prefix → substring, then higher
 * priority, then higher usage count, then alphabetical — deduped by normalized
 * value and capped at `limit`.
 *
 * Correction: computed ONLY when there are no direct matches at all (so it never
 * competes with real suggestions), the query is long enough, and a single known
 * value sits within the length-scaled edit budget. The nearest such value wins;
 * ties break on higher priority then count. Returns null otherwise.
 */
export function rankSuggestions(
  entries: readonly SuggestionEntry[],
  rawQuery: string,
  options: { limit?: number } = {}
): RankSuggestionsResult {
  const limit = options.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const query = normalizeRoleGroupToken(rawQuery);
  if (!query) {
    return { matches: [], correction: null };
  }

  type Scored = {
    entry: SuggestionEntry;
    normalizedValue: string;
    rank: number;
  };

  // 1. Direct matches, deduped by normalized value (first/best wins).
  const byValue = new Map<string, Scored>();
  for (const entry of entries) {
    const matchKeys = normalizedMatchKeys(entry);
    const rank = bestMatchRank(matchKeys, query);
    if (rank === null) {
      continue;
    }
    const normalizedValue = normalizeRoleGroupToken(entry.value);
    if (!normalizedValue) {
      continue;
    }
    const existing = byValue.get(normalizedValue);
    if (
      !existing ||
      rank < existing.rank ||
      (rank === existing.rank && (entry.priority ?? 0) > (existing.entry.priority ?? 0))
    ) {
      byValue.set(normalizedValue, { entry, normalizedValue, rank });
    }
  }

  const sorted = [...byValue.values()].sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    const priorityDelta = (b.entry.priority ?? 0) - (a.entry.priority ?? 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const countDelta = (b.entry.count ?? 0) - (a.entry.count ?? 0);
    if (countDelta !== 0) {
      return countDelta;
    }
    return a.entry.value.localeCompare(b.entry.value);
  });

  const matches = sorted.slice(0, limit).map(({ entry }) => toRanked(entry, "match"));

  // 2. Correction — only when NOTHING matched directly (never alongside real
  // suggestions) and the query is long enough to trust.
  let correction: RankedSuggestion | null = null;
  if (matches.length === 0 && query.length >= CORRECTION_MIN_QUERY_LENGTH) {
    let best: { entry: SuggestionEntry; distance: number } | null = null;
    for (const entry of entries) {
      for (const key of normalizedCorrectionKeys(entry)) {
        if (key === query) {
          continue;
        }
        const budget = correctionBudget(query, key);
        const distance = levenshtein(query, key, budget);
        if (distance > budget) {
          continue;
        }
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance && (entry.priority ?? 0) > (best.entry.priority ?? 0))
        ) {
          best = { entry, distance };
        }
      }
    }
    if (best) {
      correction = toRanked(best.entry, "correction");
    }
  }

  return { matches, correction };
}

function toRanked(entry: SuggestionEntry, kind: SuggestionKind): RankedSuggestion {
  return {
    value: entry.value,
    detail: entry.detail ?? null,
    count: entry.count ?? null,
    companyId: entry.companyId ?? null,
    canonicalKey: entry.canonicalKey ?? null,
    kind
  };
}

// ---------------------------------------------------------------------------
// Comma-token helpers (client): the Job titles / Locations fields accept a
// comma-separated list, so a suggestion must apply to the CURRENT token only
// (the one the caret sits in) and never wipe the others.
// ---------------------------------------------------------------------------

export type TokenRange = { start: number; end: number };

/** The [start, end) slice of `value` that the caret currently sits inside. */
export function activeTokenRange(value: string, caret: number): TokenRange {
  const clamped = Math.max(0, Math.min(caret, value.length));
  const commaBefore = value.lastIndexOf(",", clamped - 1);
  const start = commaBefore === -1 ? 0 : commaBefore + 1;
  const commaAfter = value.indexOf(",", clamped);
  const end = commaAfter === -1 ? value.length : commaAfter;
  return { start, end };
}

/** The trimmed text of the token the caret is in — what we query suggestions for. */
export function activeToken(value: string, caret: number): string {
  const { start, end } = activeTokenRange(value, caret);
  return value.slice(start, end).trim();
}

/**
 * Replace only the caret's token with `replacement`, preserving the whitespace
 * that follows the preceding comma (so "Software Engineer, rec" → "Software
 * Engineer, Recruiter" keeps the space). Returns the new value and the caret
 * position at the end of the inserted token.
 */
export function replaceActiveToken(
  value: string,
  caret: number,
  replacement: string
): { value: string; caret: number } {
  const { start, end } = activeTokenRange(value, caret);
  const leadingWhitespace = value.slice(start, end).match(/^\s*/)?.[0] ?? "";
  const inserted = `${leadingWhitespace}${replacement}`;
  const nextValue = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
  return { value: nextValue, caret: start + inserted.length };
}
