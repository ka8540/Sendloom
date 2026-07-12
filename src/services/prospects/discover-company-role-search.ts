// Same-company Discover search ("Search this company" on the company detail
// page): pure validation + duplicate resolution shared by the server mutation
// and the client-side pre-check, so both sides always agree on what counts as
// a duplicate.
//
// Identity is the existing canonical role-group fold (discover-role-group-key):
// same normalized role + same normalized location (casing / extra spaces /
// punctuation glyphs never matter, and a blank location only ever equals
// another blank location). "Software Engineer · Canada" is therefore a NEW
// group next to "Software Engineer · United States", while
// "  software  engineer " · "united states" is a duplicate of it. Nothing here
// maps one role or location onto another, and no company/role/location is ever
// hardcoded.
//
// No I/O and no React imports — node-only vitest can exercise every branch.

import { roleGroupKeyFor } from "@/services/prospects/discover-role-group-key";

/** Mirrors the create-search limits so this path can never exceed them. */
export const MAX_COMPANY_ROLE_LENGTH = 200;
export const MAX_COMPANY_ROLE_LOCATION_LENGTH = 200;

// User-facing copy for every rejection. The server returns these messages
// verbatim (they carry no internals) and the client pre-check shows the same
// strings, so the user sees one voice regardless of which side answered.
export const COMPANY_ROLE_SEARCH_MESSAGES = {
  duplicateReady: "This role and location already exist. Use Add 10 more to extend this group.",
  duplicateRunning: "This role and location search is already running. It will appear here when it finishes.",
  duplicateFailed:
    "A previous search for this role and location failed. Retry that search instead of starting a new one.",
  emptyRole: "Enter a job title to search.",
  roleTooLong: `Job titles must be at most ${MAX_COMPANY_ROLE_LENGTH} characters.`,
  locationTooLong: `Locations must be at most ${MAX_COMPANY_ROLE_LOCATION_LENGTH} characters.`
} as const;

export type CompanyRoleSearchValidation =
  | { ok: true; jobTitle: string; location: string | null }
  | { ok: false; error: "EMPTY_ROLE" | "ROLE_TOO_LONG" | "LOCATION_TOO_LONG"; message: string };

/**
 * Trim + bound the raw form input. A blank location is normalized to null (the
 * "any location" group) so every caller treats blank/whitespace/missing the
 * same way.
 */
export function validateCompanyRoleSearchInput(input: {
  jobTitle: string | null | undefined;
  location?: string | null | undefined;
}): CompanyRoleSearchValidation {
  const jobTitle = (input.jobTitle ?? "").trim();
  if (!jobTitle) {
    return { ok: false, error: "EMPTY_ROLE", message: COMPANY_ROLE_SEARCH_MESSAGES.emptyRole };
  }
  if (jobTitle.length > MAX_COMPANY_ROLE_LENGTH) {
    return { ok: false, error: "ROLE_TOO_LONG", message: COMPANY_ROLE_SEARCH_MESSAGES.roleTooLong };
  }
  const location = (input.location ?? "").trim();
  if (location.length > MAX_COMPANY_ROLE_LOCATION_LENGTH) {
    return { ok: false, error: "LOCATION_TOO_LONG", message: COMPANY_ROLE_SEARCH_MESSAGES.locationTooLong };
  }
  return { ok: true, jobTitle, location: location || null };
}

/** One of the user's existing searches for THIS company (any status). */
export type CompanyRoleSearchCandidate = {
  id: string;
  status: string;
  requestedTitles: unknown;
  requestedLocations: unknown;
};

export type CompanyRoleSearchAction =
  | { kind: "create" }
  /** An identical DRAFT already exists — process it instead of adding a row. */
  | { kind: "reuse-draft"; searchId: string }
  | { kind: "duplicate"; reason: "ready" | "running" | "failed"; searchId: string; message: string };

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Statuses that mean the pipeline is actively running right now. */
const RUNNING_STATUSES = new Set([
  "RESOLVING_COMPANY",
  "SEARCHING_PEOPLE",
  "CLASSIFYING_POSITIONS",
  "INFERRING_EMAIL_PATTERN"
]);

/**
 * Decide what submitting role+location for a company the user already searched
 * should do. Matching is by canonical role-group key only — a different
 * normalized role OR location is always allowed through as "create".
 *
 * Duplicate precedence when several same-key siblings exist:
 *   READY   → point the user at "Add 10 more" (the group already has people);
 *   running → tell them it is already in flight (never start a twin);
 *   DRAFT   → silently reuse the draft (also makes a replayed mutation
 *             idempotent: the replay finds the row the first call created);
 *   FAILED  → direct them to the existing retry flow for that search.
 * CANCELED siblings never block — the user abandoned them.
 */
export function resolveCompanyRoleSearchAction(input: {
  jobTitle: string;
  location: string | null | undefined;
  existingSearches: readonly CompanyRoleSearchCandidate[];
}): CompanyRoleSearchAction {
  const requestedKey = roleGroupKeyFor({
    requestedTitles: [input.jobTitle],
    requestedLocations: input.location ? [input.location] : []
  });

  const matches = input.existingSearches.filter(
    (search) =>
      search.status !== "CANCELED" &&
      roleGroupKeyFor({
        requestedTitles: toStringArray(search.requestedTitles),
        requestedLocations: toStringArray(search.requestedLocations)
      }) === requestedKey
  );
  if (matches.length === 0) {
    return { kind: "create" };
  }

  const ready = matches.find((search) => search.status === "READY");
  if (ready) {
    return {
      kind: "duplicate",
      reason: "ready",
      searchId: ready.id,
      message: COMPANY_ROLE_SEARCH_MESSAGES.duplicateReady
    };
  }
  const running = matches.find((search) => RUNNING_STATUSES.has(search.status));
  if (running) {
    return {
      kind: "duplicate",
      reason: "running",
      searchId: running.id,
      message: COMPANY_ROLE_SEARCH_MESSAGES.duplicateRunning
    };
  }
  const draft = matches.find((search) => search.status === "DRAFT");
  if (draft) {
    return { kind: "reuse-draft", searchId: draft.id };
  }
  // Only FAILED (or an unknown legacy status, treated conservatively) remains.
  return {
    kind: "duplicate",
    reason: "failed",
    searchId: matches[0].id,
    message: COMPANY_ROLE_SEARCH_MESSAGES.duplicateFailed
  };
}
