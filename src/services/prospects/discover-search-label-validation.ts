// Authoritative Discover ROLE / LOCATION input-integrity boundary.
//
// This module is deliberately pure and dependency-light so the browser form,
// GraphQL resolver, service write boundary, suggestion source, and repair
// script all make the same decision. It performs no I/O and knows nothing
// about users, quota, providers, caches, or React.

import {
  COMMON_LOCATION_LABELS,
  COMMON_ROLE_LABELS
} from "@/services/prospects/discover-canonical-labels";
import { normalizeRoleGroupToken } from "@/services/prospects/discover-role-group-key";
import { levenshtein, titleCaseLabel } from "@/services/prospects/discover-suggestions";

export type DiscoverSearchLabelType = "ROLE" | "LOCATION";

export type DiscoverLabelValidationResult =
  | { status: "VALID"; value: string }
  | { status: "CORRECTED"; value: string; original: string }
  | {
      status: "AMBIGUOUS";
      original: string;
      suggestions: string[];
      message: string;
    }
  | {
      status: "INVALID";
      original: string;
      suggestions: string[];
      message: string;
    };

export type DiscoverLabelListValidation =
  | { ok: true; values: string[] }
  | {
      ok: false;
      index: number;
      status: "AMBIGUOUS" | "INVALID";
      original: string;
      suggestions: string[];
      message: string;
    };

const MAX_LABEL_LENGTH = 200;
const MAX_SUGGESTIONS = 5;
const CORRECTION_MAX_DISTANCE = 5;
const MIN_FUZZY_LENGTH = 4;

const LABEL_MESSAGES = {
  ROLE: {
    ambiguous: "Choose one of the suggested job titles before searching.",
    invalid: "Check the job title before searching."
  },
  LOCATION: {
    ambiguous: "Choose a complete location before searching.",
    invalid: "Choose a complete location before searching."
  }
} as const;

function commonLabels(type: DiscoverSearchLabelType): readonly string[] {
  return type === "ROLE" ? COMMON_ROLE_LABELS : COMMON_LOCATION_LABELS;
}

function uniqueCanonical(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = titleCaseLabel(raw);
    const key = normalizeRoleGroupToken(value);
    if (!value || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function compactKey(value: string): string {
  return normalizeRoleGroupToken(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function strictBudget(a: string, b: string): number {
  return Math.min(CORRECTION_MAX_DISTANCE, Math.max(1, Math.floor(Math.max(a.length, b.length) / 4)));
}

function hasSafeShape(value: string): boolean {
  if (!value || value.length > MAX_LABEL_LENGTH || !/[\p{L}\p{N}]/u.test(value)) {
    return false;
  }
  // Professional/location punctuation supported by the existing UI. Reject
  // symbols outside this set and obvious punctuation spam while preserving
  // legitimate labels such as "VP, R&D", "St. John's", and "EMEA/APAC".
  if (!/^[\p{L}\p{N}\s.,'’&/()\-]+$/u.test(value)) {
    return false;
  }
  if (/([.,'’&/()\-])\1{2,}/u.test(value)) {
    return false;
  }
  return true;
}

function correctedOrValid(raw: string, value: string): DiscoverLabelValidationResult {
  return raw === value ? { status: "VALID", value } : { status: "CORRECTED", value, original: raw };
}

type CandidateScore = { value: string; distance: number; similarity: number };

function scoreCandidate(target: string, candidate: string): CandidateScore {
  const targetCompact = compactKey(target);
  const candidateCompact = compactKey(candidate);
  const maxLength = Math.max(targetCompact.length, candidateCompact.length);
  const distance = levenshtein(targetCompact, candidateCompact, Math.max(CORRECTION_MAX_DISTANCE, 8));
  return {
    value: candidate,
    distance,
    similarity: maxLength > 0 ? 1 - distance / maxLength : 0
  };
}

function rankedScores(target: string, pool: readonly string[]): CandidateScore[] {
  return pool
    .map((candidate) => scoreCandidate(target, candidate))
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity || a.value.localeCompare(b.value));
}

function invalid(
  type: DiscoverSearchLabelType,
  original: string,
  suggestions: string[] = []
): DiscoverLabelValidationResult {
  return {
    status: "INVALID",
    original,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    message: LABEL_MESSAGES[type].invalid
  };
}

function ambiguous(
  type: DiscoverSearchLabelType,
  original: string,
  suggestions: string[]
): DiscoverLabelValidationResult {
  return {
    status: "AMBIGUOUS",
    original,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    message: LABEL_MESSAGES[type].ambiguous
  };
}

/**
 * Validate against an already trusted pool. Unknown but structurally plausible
 * complete labels remain valid; uncertainty is blocked when the value is an
 * incomplete prefix or an obvious near-miss of trusted labels.
 */
function validateAgainstPool(
  type: DiscoverSearchLabelType,
  raw: string,
  trustedPool: readonly string[]
): DiscoverLabelValidationResult {
  const original = raw ?? "";
  const clean = titleCaseLabel(original);
  if (!hasSafeShape(clean)) {
    return invalid(type, original);
  }

  const targetKey = normalizeRoleGroupToken(clean);
  const exact = trustedPool.find((candidate) => normalizeRoleGroupToken(candidate) === targetKey);
  if (exact) {
    return correctedOrValid(original, exact);
  }

  // A strict prefix is editing state, not a final label. A one-character unique
  // completion ("Toront" -> "Toronto") is safe; longer or multi-match prefixes
  // require a selection.
  const prefixMatches = trustedPool.filter((candidate) => {
    const candidateKey = normalizeRoleGroupToken(candidate);
    return candidateKey.length > targetKey.length && candidateKey.startsWith(targetKey);
  });
  if (prefixMatches.length > 0) {
    if (prefixMatches.length === 1) {
      const candidate = prefixMatches[0];
      const candidateKey = normalizeRoleGroupToken(candidate);
      if (levenshtein(targetKey, candidateKey, 1) === 1) {
        return { status: "CORRECTED", value: candidate, original };
      }
    }
    return ambiguous(type, original, prefixMatches);
  }

  if (targetKey.length >= MIN_FUZZY_LENGTH) {
    const scores = rankedScores(clean, trustedPool);
    const best = scores[0];
    if (best) {
      const targetCompact = compactKey(clean);
      const candidateCompact = compactKey(best.value);
      const budget = strictBudget(targetCompact, candidateCompact);
      const tiedBest = scores.filter((score) => score.distance === best.distance);
      if (best.distance <= budget) {
        if (tiedBest.length === 1) {
          return { status: "CORRECTED", value: best.value, original };
        }
        return ambiguous(
          type,
          original,
          tiedBest.map((score) => score.value)
        );
      }

      // The malformed compact role "Softenginner" sits just outside the
      // conservative whole-label budget but still uniquely resembles
      // "Software Engineer". This broader rule is ROLE-only, requires strong
      // similarity and a clear margin, and never risks India/Indiana-style
      // location merging.
      if (type === "ROLE" && best.distance <= 6 && best.similarity >= 0.65) {
        const second = scores[1];
        if (!second || best.distance + 1 < second.distance || best.similarity - second.similarity >= 0.08) {
          return { status: "CORRECTED", value: best.value, original };
        }
        return ambiguous(
          type,
          original,
          scores
            .filter((score) => score.distance <= best.distance + 1)
            .map((score) => score.value)
        );
      }
    }
  }

  // Short arbitrary fragments are never treated as completed labels. Trusted
  // short codes/acronyms already returned through the exact-match branch.
  if (targetKey.length < 3) {
    return invalid(type, original);
  }

  return correctedOrValid(original, clean);
}

/**
 * Sanitize historical labels before they are allowed into a trusted pool.
 * Database presence alone is never enough: every value is first checked only
 * against the built-in canonical dictionary and the deterministic safety rules.
 */
export function sanitizeDiscoverSuggestionLabel(
  type: DiscoverSearchLabelType,
  raw: string
): string | null {
  const base = uniqueCanonical(commonLabels(type));
  const result = validateAgainstPool(type, raw, base);
  return result.status === "VALID" || result.status === "CORRECTED" ? result.value : null;
}

export function buildTrustedDiscoverLabelPool(
  type: DiscoverSearchLabelType,
  historical: readonly string[] = []
): string[] {
  const safeHistory = historical
    .map((label) => sanitizeDiscoverSuggestionLabel(type, label))
    .filter((label): label is string => Boolean(label));
  return uniqueCanonical([...commonLabels(type), ...safeHistory]);
}

export function validateDiscoverSearchLabel(input: {
  type: DiscoverSearchLabelType;
  value: string;
  knownValues?: readonly string[];
}): DiscoverLabelValidationResult {
  return validateAgainstPool(
    input.type,
    input.value,
    buildTrustedDiscoverLabelPool(input.type, input.knownValues ?? [])
  );
}

export function validateDiscoverSearchLabels(input: {
  type: DiscoverSearchLabelType;
  values: readonly string[];
  knownValues?: readonly string[];
}): DiscoverLabelListValidation {
  const trustedPool = buildTrustedDiscoverLabelPool(input.type, input.knownValues ?? []);
  const values: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < input.values.length; index += 1) {
    const result = validateAgainstPool(input.type, input.values[index], trustedPool);
    if (result.status === "AMBIGUOUS" || result.status === "INVALID") {
      return { ok: false, index, ...result };
    }
    const key = normalizeRoleGroupToken(result.value);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(result.value);
    }
  }

  return { ok: true, values };
}
