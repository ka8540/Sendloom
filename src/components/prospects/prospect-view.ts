// Pure presentation helpers for the Discover dashboard. No React / no DOM
// imports here on purpose: this is where the page's branching logic lives so it
// can be unit-tested under the project's node-only vitest setup.

import type {
  ConfidenceLevel,
  DiscoverQuota,
  EmailCandidateStatus,
  PersonNode,
  PositionCategory,
  ProspectSelectionInput,
  ProspectSearchNode,
  ProspectSearchStatus
} from "@/components/prospects/prospect-graphql";

// External links to LinkedIn always open in a new tab with a hardened rel so we
// never leak the opener or referrer.
export const EXTERNAL_LINK_TARGET = "_blank";
export const EXTERNAL_LINK_REL = "noopener noreferrer";

// The single warning shown above the people table. Inferred is NOT verified.
export const INFERRED_EMAIL_NOTICE =
  "Generated emails are inferred from the selected email domain and pattern until verified.";

// User-facing product copy. Kept here (not inline JSX) so the page never leaks
// backend/debug language and the wording is unit-testable. Never use graph or
// resolver terminology in the UI — those are internal terms.
export const PROSPECT_FINDER_TITLE = "Discover";
export const PROSPECT_FINDER_TAGLINE = "Search";
export const PROSPECT_FINDER_SUBTITLE =
  "Find relevant professionals by company, role, and location, then prepare their work contacts for outreach.";
export const PROSPECT_FINDER_UNAVAILABLE_TITLE = "Discover is not available right now.";
export const PROSPECT_FINDER_UNAVAILABLE_BODY =
  "This workspace doesn't have Discover turned on yet. Check back soon, or reach out to your workspace admin.";

// The GraphQL error code processProspectSearch returns when the daily quota is
// spent. The client recognizes it to show a clean product message.
export const DISCOVER_DAILY_LIMIT_ERROR_CODE = "DISCOVER_DAILY_LIMIT_REACHED";

/** "Up to 10 people per search" — driven by the live quota so it never drifts. */
export function discoverPerSearchCopy(quota: Pick<DiscoverQuota, "resultsPerSearch"> | null): string {
  const perSearch = quota?.resultsPerSearch ?? 10;
  return `Up to ${perSearch} people per search`;
}

/** Full sentence form for the modal helper row. */
export function discoverPerSearchSentence(quota: Pick<DiscoverQuota, "resultsPerSearch"> | null): string {
  const perSearch = quota?.resultsPerSearch ?? 10;
  return `Each search returns up to ${perSearch} people.`;
}

// Total page count for a known result total at a fixed page size (>= 1).
export function resolvePageCount(totalCount: number, pageSize: number): number {
  if (!Number.isFinite(totalCount) || totalCount <= 0 || pageSize <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

// Compact pager label, e.g. "Page 1 of 3". Never the words "Previous"/"Next" —
// the controls themselves are chevron icon buttons.
export function formatPageLabel(input: { pageIndex: number; pageCount: number }): string {
  const current = Math.max(1, input.pageIndex + 1);
  const total = Math.max(current, input.pageCount);
  return `Page ${current} of ${total}`;
}

export type BadgeTone = "verified" | "inferred" | "neutral" | "warning" | "muted" | "blocked";

export type Badge = {
  label: string;
  tone: BadgeTone;
  /** Longer text for a title/tooltip. */
  hint: string;
};

/**
 * Map an email candidate status to a badge. Only a real backend VERIFIED status
 * uses the green "verified" tone — every inferred status is clearly labelled
 * "Inferred" and never uses the verified styling.
 */
export function emailStatusBadge(status: EmailCandidateStatus): Badge {
  switch (status) {
    case "VERIFIED":
      return { label: "Verified", tone: "verified", hint: "Verified deliverable address." };
    case "INFERRED_HIGH":
      return { label: "Inferred · High", tone: "inferred", hint: "Inferred from the selected email domain and pattern (high confidence). Not verified." };
    case "INFERRED_MEDIUM":
      return { label: "Inferred · Medium", tone: "neutral", hint: "Inferred from the selected email domain and pattern (medium confidence). Not verified." };
    case "INFERRED_LOW":
      return { label: "Inferred · Low", tone: "warning", hint: "Inferred from the selected email domain and pattern (low confidence). Not verified." };
    case "SUPPRESSED":
      return { label: "Suppressed", tone: "blocked", hint: "Suppressed — excluded from outreach." };
    case "INVALID":
      return { label: "Invalid", tone: "blocked", hint: "The address failed validation." };
    case "UNAVAILABLE":
    default:
      return { label: "Unavailable", tone: "muted", hint: "No address could be inferred." };
  }
}

/** True only for VERIFIED — used to guard the green styling in the UI. */
export function isVerifiedStatus(status: EmailCandidateStatus): boolean {
  return status === "VERIFIED";
}

export function confidenceBadge(level: ConfidenceLevel): Badge {
  switch (level) {
    case "HIGH":
      return { label: "High", tone: "inferred", hint: "High confidence." };
    case "MEDIUM":
      return { label: "Medium", tone: "neutral", hint: "Medium confidence." };
    case "LOW":
      return { label: "Low", tone: "warning", hint: "Low confidence." };
    case "UNAVAILABLE":
    default:
      return { label: "Unknown", tone: "muted", hint: "Confidence unavailable." };
  }
}

/**
 * Whether a copy-email control should render for this person. Only when an
 * inferred email is actually present — an UNAVAILABLE/empty email is never
 * copyable.
 */
export function isEmailCopyable(person: Pick<PersonNode, "inferredEmail" | "emailStatus">): boolean {
  return Boolean(person.inferredEmail && person.inferredEmail.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Search status presentation.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ProspectSearchStatus, string> = {
  DRAFT: "Draft",
  RESOLVING_COMPANY: "Resolving company",
  SEARCHING_PEOPLE: "Searching people",
  CLASSIFYING_POSITIONS: "Classifying roles",
  INFERRING_EMAIL_PATTERN: "Inferring email format",
  READY: "Ready",
  FAILED: "Failed",
  CANCELED: "Canceled"
};

export function statusLabel(status: ProspectSearchStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusBadge(status: ProspectSearchStatus): Badge {
  if (status === "READY") {
    return { label: STATUS_LABELS.READY, tone: "verified", hint: "Search completed." };
  }
  if (status === "FAILED") {
    return { label: STATUS_LABELS.FAILED, tone: "blocked", hint: "Search failed." };
  }
  if (status === "CANCELED") {
    return { label: STATUS_LABELS.CANCELED, tone: "muted", hint: "Search canceled." };
  }
  return { label: statusLabel(status), tone: "inferred", hint: "Search in progress." };
}

export function isProcessingStatus(status: ProspectSearchStatus): boolean {
  return (
    status === "DRAFT" ||
    status === "RESOLVING_COMPANY" ||
    status === "SEARCHING_PEOPLE" ||
    status === "CLASSIFYING_POSITIONS" ||
    status === "INFERRING_EMAIL_PATTERN"
  );
}

/** A safe, user-facing error for a FAILED search (never raw transport errors). */
export function formatSearchError(search: Pick<ProspectSearchNode, "errorCode" | "errorMessage">): {
  code: string;
  message: string;
} {
  const code = search.errorCode?.trim() || "ERROR";
  const message =
    search.errorMessage?.trim() ||
    "The search could not be completed. Try processing it again with fewer results.";
  return { code, message };
}

// ---------------------------------------------------------------------------
// View-state resolvers (drive which card/empty-state renders).
// ---------------------------------------------------------------------------

export type ProspectPageState = "disabled" | "loading" | "empty" | "ready";

export function resolveProspectPageState(input: {
  disabled: boolean;
  loading: boolean;
  searchCount: number;
}): ProspectPageState {
  if (input.disabled) {
    return "disabled";
  }
  if (input.loading && input.searchCount === 0) {
    return "loading";
  }
  if (input.searchCount === 0) {
    return "empty";
  }
  return "ready";
}

export type SelectedSearchView = "none" | "processing" | "failed" | "canceled" | "ready";

export function resolveSelectedSearchView(
  search: Pick<ProspectSearchNode, "status" | "company"> | null
): SelectedSearchView {
  if (!search) {
    return "none";
  }
  if (search.status === "FAILED") {
    return "failed";
  }
  if (search.status === "CANCELED") {
    return "canceled";
  }
  if (search.status === "READY" && search.company) {
    return "ready";
  }
  return "processing";
}

// ---------------------------------------------------------------------------
// Small formatting helpers.
// ---------------------------------------------------------------------------

/** Compose a human location from the structured fields, falling back to raw. */
export function personLocation(
  person: Pick<PersonNode, "location" | "city" | "state" | "country">
): string {
  const parts = [person.city, person.state, person.country].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return person.location?.trim() || "—";
}

/** "Showing 1–20 of 134" style label for the people table. */
export function formatShowingLabel(input: { offset: number; pageCount: number; totalCount: number }): string {
  if (input.pageCount <= 0) {
    return "No people to show";
  }
  const start = input.offset + 1;
  const end = input.offset + input.pageCount;
  return `Showing ${start}–${end} of ${input.totalCount}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Local text filter over an already-loaded page of people. */
export function filterPeopleByText(people: PersonNode[], query: string): PersonNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return people;
  }
  return people.filter((person) => {
    const haystack = [person.fullName, person.currentTitle, person.inferredEmail, personLocation(person)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

// ---------------------------------------------------------------------------
// Selection helpers.
// ---------------------------------------------------------------------------

export type ExplicitProspectSelection = {
  mode: "explicit";
  selectedIds: Set<string>;
};

export type AllMatchingProspectSelection = {
  mode: "allMatching";
  companyId: string;
  positionCategory: PositionCategory | null;
  excludedIds: Set<string>;
};

export type ProspectSelectionState = ExplicitProspectSelection | AllMatchingProspectSelection;
export type PageSelectionState = "checked" | "unchecked" | "indeterminate";

export function createEmptyProspectSelection(): ProspectSelectionState {
  return { mode: "explicit", selectedIds: new Set() };
}

export function isProspectSelectionEmpty(selection: ProspectSelectionState): boolean {
  return selection.mode === "explicit" && selection.selectedIds.size === 0;
}

export function scopeMatchesSelection(
  selection: ProspectSelectionState,
  scope: { companyId: string; positionCategory: PositionCategory | null }
): boolean {
  if (selection.mode === "explicit") {
    return true;
  }
  return (
    selection.companyId === scope.companyId &&
    (selection.positionCategory === null || selection.positionCategory === scope.positionCategory)
  );
}

export function isProspectSelected(
  selection: ProspectSelectionState,
  personId: string,
  scope: { companyId: string; positionCategory: PositionCategory | null }
): boolean {
  if (selection.mode === "explicit") {
    return selection.selectedIds.has(personId);
  }
  return scopeMatchesSelection(selection, scope) && !selection.excludedIds.has(personId);
}

export function getProspectSelectionCount(selection: ProspectSelectionState, allMatchingTotal: number): number {
  if (selection.mode === "explicit") {
    return selection.selectedIds.size;
  }
  return Math.max(0, allMatchingTotal - selection.excludedIds.size);
}

export function toggleProspectSelection(
  selection: ProspectSelectionState,
  personId: string,
  scope: { companyId: string; positionCategory: PositionCategory | null }
): ProspectSelectionState {
  if (selection.mode === "allMatching" && scopeMatchesSelection(selection, scope)) {
    const excludedIds = new Set(selection.excludedIds);
    if (excludedIds.has(personId)) {
      excludedIds.delete(personId);
    } else {
      excludedIds.add(personId);
    }
    return { ...selection, excludedIds };
  }

  const selectedIds = selection.mode === "explicit" ? new Set(selection.selectedIds) : new Set<string>();
  if (selectedIds.has(personId)) {
    selectedIds.delete(personId);
  } else {
    selectedIds.add(personId);
  }
  return { mode: "explicit", selectedIds };
}

export function getPageSelectionState(
  selection: ProspectSelectionState,
  pageIds: string[],
  scope: { companyId: string; positionCategory: PositionCategory | null }
): PageSelectionState {
  if (pageIds.length === 0) {
    return "unchecked";
  }
  const selectedCount = pageIds.filter((id) => isProspectSelected(selection, id, scope)).length;
  if (selectedCount === 0) {
    return "unchecked";
  }
  return selectedCount === pageIds.length ? "checked" : "indeterminate";
}

export function togglePageProspectSelection(
  selection: ProspectSelectionState,
  pageIds: string[],
  scope: { companyId: string; positionCategory: PositionCategory | null }
): ProspectSelectionState {
  if (pageIds.length === 0) {
    return selection;
  }

  const pageState = getPageSelectionState(selection, pageIds, scope);
  const shouldSelect = pageState !== "checked";

  if (selection.mode === "allMatching" && scopeMatchesSelection(selection, scope)) {
    const excludedIds = new Set(selection.excludedIds);
    for (const id of pageIds) {
      if (shouldSelect) {
        excludedIds.delete(id);
      } else {
        excludedIds.add(id);
      }
    }
    return { ...selection, excludedIds };
  }

  const selectedIds = selection.mode === "explicit" ? new Set(selection.selectedIds) : new Set<string>();
  for (const id of pageIds) {
    if (shouldSelect) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
  }
  return { mode: "explicit", selectedIds };
}

export function selectAllMatchingProspects(scope: {
  companyId: string;
  positionCategory: PositionCategory | null;
}): ProspectSelectionState {
  return { mode: "allMatching", companyId: scope.companyId, positionCategory: scope.positionCategory, excludedIds: new Set() };
}

export function buildProspectSelectionInput(
  selection: ProspectSelectionState,
  companyId: string
): ProspectSelectionInput | null {
  if (selection.mode === "explicit") {
    if (selection.selectedIds.size === 0) {
      return null;
    }
    return {
      companyId,
      mode: "EXPLICIT",
      selectedIds: Array.from(selection.selectedIds),
      excludedIds: [],
      positionCategory: null
    };
  }

  if (selection.companyId !== companyId) {
    return null;
  }

  return {
    companyId,
    mode: "ALL_MATCHING",
    selectedIds: [],
    excludedIds: Array.from(selection.excludedIds),
    positionCategory: selection.positionCategory
  };
}

// ---------------------------------------------------------------------------
// Discover daily-quota presentation helpers.
// ---------------------------------------------------------------------------

/**
 * Compact remaining-count label, e.g. "3 of 4 searches remaining today".
 * Exempt (unlimited) accounts return null so the caller can hide the count or
 * show an "Unlimited" label instead — the limit is never rendered for them.
 */
export function formatQuotaRemaining(quota: DiscoverQuota | null): string | null {
  if (!quota || quota.unlimited) {
    return null;
  }
  return `${quota.searchesRemaining} of ${quota.dailySearchLimit} searches remaining today`;
}

/** "Resets at 12:00 AM" rendered in the viewer's local timezone. */
export function formatQuotaReset(quota: Pick<DiscoverQuota, "resetAt"> | null): string | null {
  if (!quota?.resetAt) {
    return null;
  }
  const date = new Date(quota.resetAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `Resets at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Whether the Process action should be blocked for a search. Only a brand-new
 * DRAFT consumes a slot, so only DRAFTs are blocked when the quota is spent;
 * retrying an already-started/FAILED search is idempotent (free) and stays
 * enabled, and exempt accounts are never blocked.
 */
export function isProcessQuotaBlocked(
  quota: DiscoverQuota | null,
  status: ProspectSearchStatus
): boolean {
  if (!quota || quota.unlimited) {
    return false;
  }
  return status === "DRAFT" && quota.searchesRemaining <= 0;
}
