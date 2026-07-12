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
  /** Company-only matching can safely ignore punctuation and URL decoration. */
  punctuationTolerant?: boolean;
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

/**
 * Additional company-search folds. The spaced form makes punctuation and URL
 * separators equivalent; the compact form also covers variants such as
 * "AcmeCo" / "Acme Co" and dotted initialisms. These aliases are opt-in so
 * role/location identity remains deliberately conservative.
 */
export function companyMatchAliases(value: string): string[] {
  const normalized = normalizeRoleGroupToken(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  return unique([normalized, normalized.replace(/\s+/g, "")]);
}

function normalizedMatchKeys(entry: SuggestionEntry): string[] {
  const raw = entry.matchKeys && entry.matchKeys.length > 0 ? entry.matchKeys : [entry.value];
  return unique(
    raw.flatMap((key) => [normalizeRoleGroupToken(key), ...(entry.punctuationTolerant ? companyMatchAliases(key) : [])])
  );
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
    const queries = unique([query, ...(entry.punctuationTolerant ? companyMatchAliases(rawQuery) : [])]);
    let rank: number | null = null;
    for (const candidateQuery of queries) {
      const candidateRank = bestMatchRank(matchKeys, candidateQuery);
      if (candidateRank !== null && (rank === null || candidateRank < rank)) {
        rank = candidateRank;
      }
    }
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
// Canonical display labels for roles / locations.
//
// Two independent, deterministic steps:
//   1. titleCaseLabel — fix casing + whitespace only ("SOftware  ENGINEER" →
//      "Software Engineer"). Acronyms the user clearly meant ("AI", "HR",
//      "SQL") are preserved. This never changes which role a label is.
//   2. canonicalizeLabel — after casing cleanup, snap a near-miss typo onto a
//      known value when (and only when) it is within the same conservative edit
//      budget the correction uses. Exact/known values always win, so a label
//      the user really has is never rewritten into a different one.
// ---------------------------------------------------------------------------

// Tokens that read as acronyms and should keep their letters uppercase rather
// than being title-cased into "Ai"/"Hr". An explicit allowlist (never a blanket
// "all-caps stays" rule, which would wrongly keep place words like "YORK" or
// "OHIO" shouted). Deliberately generic — no company or product names.
const ACRONYM_TOKENS = new Set([
  "ai",
  "ml",
  "ar",
  "vr",
  "hr",
  "it",
  "qa",
  "ux",
  "ui",
  "pm",
  "sre",
  "seo",
  "sem",
  "sdr",
  "bdr",
  "vp",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "cio",
  "sql",
  "aws",
  "gcp",
  "api",
  "sdk",
  "crm",
  "erp",
  "nlp",
  "cpu",
  "gpu",
  "ios",
  "hrbp"
]);

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (ACRONYM_TOKENS.has(lower)) {
    return lower.toUpperCase();
  }
  // Preserve 2-letter all-caps codes (US / CA / TX / UK / NY …) so a location
  // like "Austin, TX" is never mangled into "Austin, Tx". Longer place words
  // ("YORK", "OHIO") are still cleaned to title case.
  if (/^[A-Z]{2}$/.test(word)) {
    return word;
  }
  if (!/[a-zA-Z]/.test(word)) {
    return word;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Clean a single role/location label's casing + whitespace without ever
 * changing which value it is. Capitalizes each alphanumeric run so
 * "SOftware Enigneer" → "Software Enigneer" and "  united   states " →
 * "United States". Empty input yields "".
 */
export function titleCaseLabel(raw: string): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }
  return collapsed.replace(/[A-Za-z0-9]+/g, (word) => titleCaseWord(word));
}

/**
 * Canonicalize a label: title-case it, then, if it is a near-miss typo of a
 * known value, snap it onto that known value (returned in its own clean form).
 * `known` is the pool of trusted values (the user's own history plus a small
 * generic dictionary). Exact matches win; unrelated input is left as its clean
 * title-cased form. Conservative by construction — the same edit budget as the
 * suggestion correction, so distinct roles are never merged.
 */
export function canonicalizeLabel(raw: string, known: readonly string[] = []): string {
  const clean = titleCaseLabel(raw);
  if (!clean) {
    return "";
  }
  const target = normalizeRoleGroupToken(clean);
  let best: { label: string; distance: number } | null = null;
  for (const candidate of known) {
    const candidateClean = titleCaseLabel(candidate);
    const candidateKey = normalizeRoleGroupToken(candidateClean);
    if (!candidateKey) {
      continue;
    }
    if (candidateKey === target) {
      // An exact (case/space-insensitive) known value always wins.
      return candidateClean;
    }
    if (target.length < CORRECTION_MIN_QUERY_LENGTH) {
      continue;
    }
    const budget = correctionBudget(target, candidateKey);
    const distance = levenshtein(target, candidateKey, budget);
    if (distance <= budget && (!best || distance < best.distance)) {
      best = { label: candidateClean, distance };
    }
  }
  return best ? best.label : clean;
}

/**
 * Canonicalize a list of labels against `known`, dropping blanks and de-duping
 * by canonical identity (so "SOftware Engineer" and "software engineer" collapse
 * to one "Software Engineer"). Order of first appearance is preserved.
 */
export function canonicalizeLabels(labels: readonly string[], known: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const canonical = canonicalizeLabel(label, known);
    if (!canonical) {
      continue;
    }
    const key = normalizeRoleGroupToken(canonical);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(canonical);
  }
  return out;
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
