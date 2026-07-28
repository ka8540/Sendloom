// Pure presentation helpers for the Discover dashboard. No React / no DOM
// imports here on purpose: this is where the page's branching logic lives so it
// can be unit-tested under the project's node-only vitest setup.

import type {
  ConfidenceLevel,
  DiscoverCompanyGroupNode,
  DiscoverQuota,
  EmailDomainEvidenceNode,
  EmailCandidateStatus,
  PatternEvidenceNode,
  PersonNode,
  PositionCategory,
  ProspectSelectionInput,
  ProspectSearchNode,
  ProspectSearchStatus
} from "@/components/prospects/prospect-graphql";
import { mapDiscoverPublicError } from "@/lib/discover-public-error";
import { parseEmailFormatDecisionMetadata } from "@/lib/email-format-decision";
import {
  normalizeRoleGroupToken,
  normalizeRoleGroupTokens,
  roleGroupKeyFor
} from "@/services/prospects/discover-role-group-key";
import { titleCaseLabel } from "@/services/prospects/discover-suggestions";

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

/**
 * Keep a stored page index inside the pages that actually exist. A shrinking
 * result set (a new search query, a deleted row) must never leave the user on a
 * page past the end.
 */
export function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (!Number.isFinite(pageIndex) || pageIndex <= 0) {
    return 0;
  }
  return Math.min(Math.floor(pageIndex), Math.max(0, pageCount - 1));
}

/**
 * Slice one page out of an ALREADY-FILTERED list. Filtering always happens over
 * the full dataset first; this is the last step, so a match anywhere in the
 * history can surface on page 1 of the filtered result.
 */
export function paginateHistoryGroups<T>(rows: T[], pageIndex: number, pageSize: number): T[] {
  if (pageSize <= 0) {
    return rows;
  }
  const start = clampPageIndex(pageIndex, resolvePageCount(rows.length, pageSize)) * pageSize;
  return rows.slice(start, start + pageSize);
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
      return {
        label: "Invalid",
        tone: "blocked",
        hint: "Address not found or failed validation. This contact will be skipped."
      };
    case "UNSUBSCRIBED":
      return { label: "Unsubscribed", tone: "muted", hint: "Recipient opted out — excluded from outreach." };
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

type EmailFormatEvidenceSummaryInput = {
  emailFormatReason: string | null;
  emailDomainConfidence: ConfidenceLevel;
  patternConfidence: ConfidenceLevel;
  selectedEmailDomain: string | null;
  selectedPattern: string | null;
  domainEvidence: EmailDomainEvidenceNode[];
  patternEvidence: PatternEvidenceNode[];
};

function compactEvidenceSourceKey(row: { sourceUrl: string | null; sourceName: string }): string {
  if (row.sourceUrl) {
    try {
      const url = new URL(row.sourceUrl);
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      // Fall through to the stable source label for historical malformed URLs.
    }
  }
  return row.sourceName.trim().toLowerCase();
}

/** Compact, deterministic agreement copy. Historical AI prose is never used. */
export function emailFormatEvidenceSummary(input: EmailFormatEvidenceSummaryInput): string {
  const metadata = parseEmailFormatDecisionMetadata(input.emailFormatReason);
  const selectedEvidence = [
    ...input.domainEvidence.filter((row) => row.emailDomain === input.selectedEmailDomain),
    ...input.patternEvidence.filter(
      (row) =>
        row.pattern === input.selectedPattern &&
        (!input.selectedEmailDomain || !row.emailDomain || row.emailDomain === input.selectedEmailDomain)
    )
  ];
  const derivedSupportingCount = new Set(selectedEvidence.map(compactEvidenceSourceKey)).size;
  const supportingCount = metadata?.supportingSourceCount ?? derivedSupportingCount;
  const conflictingCount = metadata?.conflictingSourceCount ?? 0;
  const limited =
    !input.selectedEmailDomain ||
    !input.selectedPattern ||
    input.emailDomainConfidence === "LOW" ||
    input.emailDomainConfidence === "UNAVAILABLE" ||
    input.patternConfidence === "LOW" ||
    input.patternConfidence === "UNAVAILABLE" ||
    metadata?.decisionCode === "INSUFFICIENT_EVIDENCE" ||
    supportingCount === 0;

  if (limited) {
    return "Limited evidence · review before sending";
  }

  const supportCopy = supportingCount === 1 ? "1 supporting source" : `${supportingCount} sources agree`;
  if (conflictingCount === 0) {
    return supportCopy;
  }
  const conflictCopy = conflictingCount === 1 ? "1 source conflicts" : `${conflictingCount} sources conflict`;
  return `${supportCopy} · ${conflictCopy}`;
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
// Email-quality summary (Discover detail dashboard).
// ---------------------------------------------------------------------------

/**
 * Whole-search quality rollup derived from the server-side per-status counts
 * (which already overlay the user's live suppression list, so a hard-bounced
 * or unsubscribed address is never reported under its stored status).
 *
 * Counting rules (aligned with the export/import eligibility in
 * services/prospects/prospect-export.ts — EXPORTABLE_STATUSES):
 *   - usable       = VERIFIED + INFERRED_HIGH + INFERRED_MEDIUM + INFERRED_LOW
 *                    (an address exists and is eligible for export/Imports)
 *   - needsReview  = INFERRED_LOW — an explicitly overlapping indicator: these
 *                    people are counted in `usable` but deserve review first.
 *   - unavailable  = UNAVAILABLE (no address could be inferred; skipped)
 *   - invalid      = INVALID (failed validation OR proven bad by a permanent
 *                    delivery failure; skipped). An invalid address is an
 *                    email-quality outcome, never an app "Failed" state.
 *   - suppressed   = SUPPRESSED (manually blocked/complaint; excluded)
 *   - unsubscribed = UNSUBSCRIBED (opted out — excluded, but NOT invalid)
 *   - verified     = VERIFIED — overlapping subset of `usable`.
 * usable + unavailable + invalid + suppressed + unsubscribed = total
 * (mutually exclusive; the server-side overlay precedence is documented in
 * lib/prospect-enums.ts#overlayEmailCandidateStatus).
 */
export type DiscoverQualitySummary = {
  total: number;
  usable: number;
  needsReview: number;
  unavailable: number;
  invalid: number;
  suppressed: number;
  unsubscribed: number;
  verified: number;
};

const USABLE_EMAIL_STATUSES: ReadonlySet<EmailCandidateStatus> = new Set([
  "VERIFIED",
  "INFERRED_HIGH",
  "INFERRED_MEDIUM",
  "INFERRED_LOW"
]);

export function deriveDiscoverQualitySummary(
  counts: ReadonlyArray<{ status: string; count: number }> | null | undefined
): DiscoverQualitySummary {
  const summary: DiscoverQualitySummary = {
    total: 0,
    usable: 0,
    needsReview: 0,
    unavailable: 0,
    invalid: 0,
    suppressed: 0,
    unsubscribed: 0,
    verified: 0
  };
  for (const row of counts ?? []) {
    const count = Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
    if (count === 0) {
      continue;
    }
    summary.total += count;
    const status = row.status as EmailCandidateStatus;
    if (USABLE_EMAIL_STATUSES.has(status)) {
      summary.usable += count;
      if (status === "INFERRED_LOW") {
        summary.needsReview += count;
      }
      if (status === "VERIFIED") {
        summary.verified += count;
      }
    } else if (status === "INVALID") {
      summary.invalid += count;
    } else if (status === "SUPPRESSED") {
      summary.suppressed += count;
    } else if (status === "UNSUBSCRIBED") {
      summary.unsubscribed += count;
    } else {
      // UNAVAILABLE and any unknown legacy status: no usable address.
      summary.unavailable += count;
    }
  }
  return summary;
}

/** Zero-safe integer percentage — never NaN, even when the total is 0. */
export function qualityPercent(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0 || count <= 0) {
    return 0;
  }
  return Math.round((count / total) * 100);
}

export type QualitySegmentTone =
  | "verified"
  | "high"
  | "medium"
  | "review"
  | "unavailable"
  | "invalid"
  | "suppressed"
  | "unsubscribed";

export type QualitySegment = {
  status: EmailCandidateStatus;
  label: string;
  tone: QualitySegmentTone;
  count: number;
  percent: number;
  /** Exact share used for the bar width so segments always fill the track. */
  share: number;
};

// Fixed display order: usable outcomes first, then the skipped ones. Labels
// mirror the People-table badge vocabulary so the page speaks one language.
// INVALID covers both validation failures and addresses proven bad by a
// permanent delivery failure; UNSUBSCRIBED stays distinct from SUPPRESSED —
// an unsubscribe is excluded but the address did not fail.
const QUALITY_SEGMENT_ORDER: ReadonlyArray<{ status: EmailCandidateStatus; label: string; tone: QualitySegmentTone }> = [
  { status: "VERIFIED", label: "Verified", tone: "verified" },
  { status: "INFERRED_HIGH", label: "Inferred · High", tone: "high" },
  { status: "INFERRED_MEDIUM", label: "Inferred · Medium", tone: "medium" },
  { status: "INFERRED_LOW", label: "Inferred · Low", tone: "review" },
  { status: "UNAVAILABLE", label: "Unavailable", tone: "unavailable" },
  { status: "INVALID", label: "Invalid", tone: "invalid" },
  { status: "SUPPRESSED", label: "Suppressed", tone: "suppressed" },
  { status: "UNSUBSCRIBED", label: "Unsubscribed", tone: "unsubscribed" }
];

/**
 * Mutually exclusive bar segments from the raw per-status counts. Zero-count
 * statuses are omitted (no empty legend rows), and with a zero total the result
 * is an empty list — the caller renders its empty state instead of a bar.
 */
export function buildQualitySegments(
  counts: ReadonlyArray<{ status: string; count: number }> | null | undefined
): QualitySegment[] {
  const byStatus = new Map<string, number>();
  let total = 0;
  for (const row of counts ?? []) {
    const count = Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
    if (count > 0) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + count);
      total += count;
    }
  }
  if (total === 0) {
    return [];
  }
  return QUALITY_SEGMENT_ORDER.filter((entry) => (byStatus.get(entry.status) ?? 0) > 0).map((entry) => {
    const count = byStatus.get(entry.status) ?? 0;
    return {
      status: entry.status,
      label: entry.label,
      tone: entry.tone,
      count,
      percent: qualityPercent(count, total),
      share: (count / total) * 100
    };
  });
}

/**
 * Plain-language summary of the rollup for screen readers and the visible
 * caption, e.g. "32 usable, 5 unavailable, 2 invalid, and 1 suppressed out of
 * 40 people." Unsubscribed appears only when present so the common case stays
 * short.
 */
export function describeQualitySummary(summary: DiscoverQualitySummary): string {
  if (summary.total <= 0) {
    return "No people with email-quality information yet.";
  }
  const parts = [
    `${summary.usable} usable`,
    `${summary.unavailable} unavailable`,
    `${summary.invalid} invalid`,
    ...(summary.unsubscribed > 0 ? [`${summary.unsubscribed} unsubscribed`] : []),
    `${summary.suppressed} suppressed`
  ];
  const joined = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  const people = summary.total === 1 ? "person" : "people";
  return `${joined} out of ${summary.total} ${people}.`;
}

// ---------------------------------------------------------------------------
// Email confidence derived from results quality (Discover detail dashboard).
// ---------------------------------------------------------------------------

/**
 * Usable-rate thresholds for the "Email confidence" shown in the Email format
 * panel: >= 80% usable → High, >= 50% → Medium, below → Low.
 */
export const EMAIL_CONFIDENCE_HIGH_USABLE_PERCENT = 80;
export const EMAIL_CONFIDENCE_MEDIUM_USABLE_PERCENT = 50;

/**
 * "Email confidence" reflects how the generated addresses actually performed —
 * the usable share of Results quality — not how strong the discovery evidence
 * looked. Computed on the SAME rounded percent the quality headline displays
 * (qualityPercent over the same counts), so the badge and the "76% usable"
 * number can never disagree. With no people counted yet there is no rate, so
 * confidence is Unknown rather than a misleading Low.
 */
export function emailConfidenceFromUsableRate(
  summary: Pick<DiscoverQualitySummary, "usable" | "total">
): ConfidenceLevel {
  if (!Number.isFinite(summary.total) || summary.total <= 0) {
    return "UNAVAILABLE";
  }
  const usablePercent = qualityPercent(summary.usable, summary.total);
  if (usablePercent >= EMAIL_CONFIDENCE_HIGH_USABLE_PERCENT) {
    return "HIGH";
  }
  if (usablePercent >= EMAIL_CONFIDENCE_MEDIUM_USABLE_PERCENT) {
    return "MEDIUM";
  }
  return "LOW";
}

// ---------------------------------------------------------------------------
// Email-format correction modes (Discover detail dashboard).
// ---------------------------------------------------------------------------

/**
 * The three correction actions are mutually exclusive modes over ONE editor
 * container — never independent booleans. "ai-refresh" is the in-flight AI
 * progress state (it has no form); "source-url" and "manual-fix" each render
 * their single editor. Exactly one mode is ever active.
 */
export type EmailFormatActionMode = "none" | "ai-refresh" | "source-url" | "manual-fix";

/**
 * Resolve the next mode for a mode-button press: pressing the active mode's
 * button closes it (back to "none"); pressing any other opens that mode and
 * implicitly closes the previous one. Repeated presses can therefore never
 * stack a second editor.
 */
export function resolveNextEmailFormatMode(
  current: EmailFormatActionMode,
  requested: Exclude<EmailFormatActionMode, "none">
): EmailFormatActionMode {
  return current === requested ? "none" : requested;
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
  NO_RESULTS: "No results",
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
  if (status === "NO_RESULTS") {
    // Neutral, never the green "Ready" or the red "Failed": the search itself
    // completed fine — it just found nobody.
    return { label: STATUS_LABELS.NO_RESULTS, tone: "muted", hint: "Search completed, but no people were found." };
  }
  if (status === "FAILED") {
    return { label: STATUS_LABELS.FAILED, tone: "blocked", hint: "Search failed." };
  }
  if (status === "CANCELED") {
    return { label: STATUS_LABELS.CANCELED, tone: "muted", hint: "Search canceled." };
  }
  return { label: statusLabel(status), tone: "inferred", hint: "Search in progress." };
}

/**
 * True for a completed search with nobody found. Covers BOTH the explicit
 * NO_RESULTS status and legacy zero-result rows that predate it (stored as
 * READY with nothing processed) — those must never render as a normal "Ready"
 * search either.
 */
export function isNoResultsSearch(
  search: Pick<ProspectSearchNode, "status" | "peopleCount">
): boolean {
  if (search.status === "NO_RESULTS") {
    return true;
  }
  return search.status === "READY" && (search.peopleCount ?? 0) <= 0;
}

/**
 * Status a search should DISPLAY as. Identical to the stored status except for
 * legacy zero-result READY rows, which read as NO_RESULTS everywhere (history
 * badges, headers, detail states).
 */
export function effectiveSearchStatus(
  search: Pick<ProspectSearchNode, "status" | "peopleCount">
): ProspectSearchStatus {
  return isNoResultsSearch(search) ? "NO_RESULTS" : search.status;
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

// ---------------------------------------------------------------------------
// Grouped Search History (one entry per company).
// ---------------------------------------------------------------------------

/** Actively running (a DRAFT is waiting on the user, not running). */
function isActivelyProcessing(status: ProspectSearchStatus): boolean {
  return isProcessingStatus(status) && status !== "DRAFT";
}

/**
 * Derived status for a consolidated company entry, from its child search
 * statuses. Documented priority:
 *   1. Processing — any child is still running.
 *   2. Needs attention — a child failed while another is usable/pending (the
 *      group is NOT marked failed because one role search failed).
 *   3. Ready — at least one child is ready, none running or failed.
 *   4. Failed — every (non-canceled) child failed.
 *   5. No results — no child found people, but none failed either.
 *   6. Draft, then Canceled.
 *
 * Callers should pass EFFECTIVE statuses (effectiveSearchStatus) so a legacy
 * zero-result READY child reads as NO_RESULTS here too.
 */
export function groupStatusBadge(statuses: ProspectSearchStatus[]): Badge {
  const active = statuses.filter((status) => status !== "CANCELED");
  const considered = active.length > 0 ? active : statuses;
  if (considered.length === 0) {
    return { label: "Draft", tone: "muted", hint: "No searches yet." };
  }
  if (considered.some(isActivelyProcessing)) {
    return { label: "Processing", tone: "inferred", hint: "A search for this company is still running." };
  }
  const failedCount = considered.filter((status) => status === "FAILED").length;
  if (failedCount === considered.length && failedCount > 0) {
    return statusBadge("FAILED");
  }
  if (failedCount > 0) {
    return { label: "Needs attention", tone: "warning", hint: "One of this company's searches failed. Open it to retry." };
  }
  if (considered.some((status) => status === "READY")) {
    return statusBadge("READY");
  }
  if (considered.some((status) => status === "NO_RESULTS")) {
    return statusBadge("NO_RESULTS");
  }
  if (considered.some((status) => status === "DRAFT")) {
    return { label: statusLabel("DRAFT"), tone: "muted", hint: "Draft search — open it to fetch people." };
  }
  return statusBadge("CANCELED");
}

/**
 * Which child search a grouped row opens: the newest READY child (the detail
 * page renders the whole company from any ready child), else the newest child
 * that still needs the user (draft/processing/failed), else the newest overall.
 */
export function resolveGroupOpenTarget<T extends { id: string; status: ProspectSearchStatus; createdAt: string }>(
  searches: T[]
): T | null {
  if (searches.length === 0) {
    return null;
  }
  const newestFirst = [...searches].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : -1)
  );
  return (
    newestFirst.find((search) => search.status === "READY") ??
    newestFirst.find((search) => search.status !== "CANCELED") ??
    newestFirst[0]
  );
}

/** "3 companies" subtitle for the grouped Search History panel. */
export function formatGroupCountLabel(totalCount: number): string {
  return `${totalCount} ${totalCount === 1 ? "company" : "companies"}`;
}

/**
 * Local, case-insensitive text filter over the WHOLE Search History dataset —
 * every company group the user has, not just the rows on the visible page (the
 * list page loads all groups up front and paginates them locally, so a match on
 * "page 7" is found while the user sits on page 1). Matches what the row
 * displays: company name, domain, requested role labels, locations (or the
 * "Any location" fallback), the derived status label, and the formatted updated
 * date. Never calls the backend — an empty or whitespace-only query returns the
 * groups untouched.
 */
export function filterHistoryGroups(
  groups: DiscoverCompanyGroupNode[],
  query: string
): DiscoverCompanyGroupNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return groups;
  }
  return groups.filter((group) => {
    const haystack = [
      group.company?.name ?? group.displayName,
      group.company?.officialWebsiteDomain,
      group.company?.officialDomain,
      ...group.requestedRoles,
      ...(group.locations.length > 0 ? group.locations : ["Any location"]),
      groupStatusBadge(group.searches.map((search) => effectiveSearchStatus(search))).label,
      formatDateTime(group.latestActivityAt)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

/**
 * Subtitle under the Search History title. Unfiltered it stays the plain
 * "30 companies"; while the user is filtering it becomes "6 of 30 companies"
 * (matches across the whole history against the untouched backend total).
 */
export function formatFilteredGroupCountLabel(input: {
  filteredCount: number;
  totalCount: number;
  hasQuery: boolean;
}): string {
  if (!input.hasQuery) {
    return formatGroupCountLabel(input.totalCount);
  }
  return `${input.filteredCount} of ${input.totalCount} ${input.totalCount === 1 ? "company" : "companies"}`;
}

/**
 * Pager label for Search History. Because the search filters the ENTIRE history
 * before it is paginated, both the range and the total describe the matched set
 * — never just the rows that happen to be on the current page.
 */
export function formatHistoryShowingLabel(input: {
  offset: number;
  rowCount: number;
  matchCount: number;
  hasQuery: boolean;
}): string {
  if (input.matchCount <= 0 || input.rowCount <= 0) {
    return input.hasQuery ? "No matching companies" : "No companies to show";
  }
  const start = input.offset + 1;
  const end = input.offset + input.rowCount;
  const noun = input.hasQuery ? (input.matchCount === 1 ? "match" : "matches") : "companies";
  return `Showing ${start}–${end} of ${input.matchCount} ${noun}`;
}

/**
 * A safe, user-facing error for a FAILED search. The backend already sanitizes
 * the failure (errorCode is a product-safe category; errorTitle/errorMessage are
 * safe copy). As defense-in-depth this re-maps through the shared public-error
 * mapper, so even a raw internal code from an older payload can never reach the
 * UI — the user only ever sees a clean title + message and a retryable flag.
 */
export function formatSearchError(
  search: Pick<ProspectSearchNode, "errorCode" | "errorTitle" | "errorMessage" | "retryable">
): { title: string; message: string; retryable: boolean } {
  const mapped = mapDiscoverPublicError(search.errorCode);
  return {
    title: search.errorTitle?.trim() || mapped.title,
    message: search.errorMessage?.trim() || mapped.message,
    retryable: typeof search.retryable === "boolean" ? search.retryable : mapped.retryable
  };
}

// ---------------------------------------------------------------------------
// Zero-result search state (a completed search that found nobody).
// ---------------------------------------------------------------------------

// Neutral no-results copy: the search worked, it just found nobody — never an
// error voice and never provider/backend terminology.
export const NO_RESULTS_TITLE = "Couldn't find any people for this search.";
export const NO_RESULTS_BODY = "Try a different job title, location, or company spelling.";
export const NO_RESULTS_COMPLETED_NOTE = "The search completed successfully — no matching people were found.";
export const NO_RESULTS_RETRY_LABEL = "Search this company again";
export const NO_RESULTS_RETRYING_LABEL = "Searching again…";
export const NO_RESULTS_BACK_LABEL = "Back to Discover";

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

export type SelectedSearchView = "none" | "processing" | "failed" | "canceled" | "no-results" | "ready";

export function resolveSelectedSearchView(
  search: Pick<ProspectSearchNode, "status" | "peopleCount" | "company"> | null
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
  // NO_RESULTS and legacy zero-result READY rows both render the clean
  // no-results state — never the normal results dashboard.
  if (isNoResultsSearch(search)) {
    return "no-results";
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

/**
 * Decide where Search History should land after deleting a row. If the deleted
 * row was the only one left on a page beyond the first, step back to the previous
 * page (never strand the user on an empty page); otherwise stay put.
 */
export function resolveHistoryPageAfterDelete(input: {
  remainingOnPage: number;
  pageIndex: number;
}): { goToPreviousPage: boolean; pageIndex: number } {
  if (input.remainingOnPage <= 0 && input.pageIndex > 0) {
    return { goToPreviousPage: true, pageIndex: input.pageIndex - 1 };
  }
  return { goToPreviousPage: false, pageIndex: input.pageIndex };
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

// ---------------------------------------------------------------------------
// Location filters (People section, grouped company detail).
// ---------------------------------------------------------------------------

export const ALL_LOCATIONS_LABEL = "All locations";
/** Dropdown option that clears the role filter (People section, detail page). */
export const ALL_ROLES_LABEL = "All roles";
/** Chip label for the group of searches that were run WITHOUT a location. */
export const ANY_LOCATION_LABEL = "Any location";
export const CLEAR_FILTERS_LABEL = "Clear filters";
export const FILTERED_PEOPLE_EMPTY_TITLE = "No people match these filters.";
export const FILTERED_PEOPLE_EMPTY_BODY =
  "Try a different role or location, or clear the filters to see everyone.";

export type LocationFilterOption = {
  /** Canonical location key (normalizeRoleGroupToken); "" = "Any location". */
  key: string;
  /** First-seen casing, for display. */
  label: string;
};

/**
 * Distinct location chips for a company's READY searches. Deduped by the same
 * canonical fold as role-group identity, so "United States" and "united
 * states" render as ONE chip (first-seen casing wins) while "Canada" stays
 * separate. Locations of unfinished searches are excluded (they have no people
 * to filter yet). The bare "Any location" chip appears only when location-less
 * searches coexist with located ones — an empty list means there is nothing to
 * filter by and the rail should not render.
 */
export function buildLocationFilterOptions(
  searches: Array<{ status: ProspectSearchStatus; requestedLocations: string[] }>
): LocationFilterOption[] {
  const seen = new Set<string>();
  const options: LocationFilterOption[] = [];
  let hasBareLocationGroup = false;
  for (const search of searches) {
    if (search.status !== "READY") {
      continue;
    }
    const tokens = normalizeRoleGroupTokens(search.requestedLocations);
    if (tokens.length === 0) {
      hasBareLocationGroup = true;
      continue;
    }
    for (const label of search.requestedLocations) {
      const key = normalizeRoleGroupToken(label);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      options.push({ key, label: label.trim() });
    }
  }
  if (options.length === 0) {
    return [];
  }
  if (hasBareLocationGroup) {
    options.push({ key: "", label: ANY_LOCATION_LABEL });
  }
  return options;
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

// The compact detail-header quota chip ("2/4"): the full meaning lives in the
// chip's aria-label and its hover/focus helper card, never in the visible row.
export const DISCOVER_QUOTA_TOOLTIP_TITLE = "Discover searches";

export type QuotaChipView = {
  /** Compact visible value, e.g. "2/4" or "Unlimited". */
  value: string;
  /** Full accessible name for the focusable chip. */
  ariaLabel: string;
  /** One-sentence helper-card body. */
  tooltip: string;
  unlimited: boolean;
};

/**
 * Chip view for the live quota. Remaining is clamped at 0 so a transient
 * negative can never render "-1/4". Unlimited (exempt) accounts show a compact
 * "Unlimited" — the numeric limit is never rendered for them. Null while the
 * quota is still loading → the chip does not render.
 */
export function formatQuotaChip(quota: DiscoverQuota | null): QuotaChipView | null {
  if (!quota) {
    return null;
  }
  if (quota.unlimited) {
    return {
      value: "Unlimited",
      ariaLabel: "Unlimited Discover access",
      tooltip: "Unlimited Discover access.",
      unlimited: true
    };
  }
  const remaining = Math.max(0, quota.searchesRemaining);
  return {
    value: `${remaining}/${quota.dailySearchLimit}`,
    ariaLabel: `${remaining} of ${quota.dailySearchLimit} Discover searches remaining today`,
    tooltip: `${remaining} of ${quota.dailySearchLimit} searches remaining today.`,
    unlimited: false
  };
}

/** Difference in whole local calendar days between two dates (to - from). */
function localCalendarDayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Reset label in the viewer's local timezone, ALWAYS qualified with the day so a
 * bare time is never ambiguous — e.g. "Resets tomorrow at 5:00 PM" (the daily
 * window resets at the next UTC midnight, which is rarely the local midnight, so
 * "Resets at 5:00 PM" alone read as today-vs-next-day was confusing).
 */
export function formatQuotaReset(
  quota: Pick<DiscoverQuota, "resetAt"> | null,
  now: Date = new Date()
): string | null {
  if (!quota?.resetAt) {
    return null;
  }
  const date = new Date(quota.resetAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dayDiff = localCalendarDayDiff(now, date);
  if (dayDiff <= 0) {
    return `Resets today at ${time}`;
  }
  if (dayDiff === 1) {
    return `Resets tomorrow at ${time}`;
  }
  const dayLabel = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `Resets ${dayLabel} at ${time}`;
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

// ---------------------------------------------------------------------------
// "Add 10 more people" presentation helpers.
// ---------------------------------------------------------------------------

export const ADD_MORE_PEOPLE_LABEL = "Add 10 more";
export const ADD_MORE_DIALOG_TITLE = "Add more people";
export const ADD_MORE_DIALOG_SUBTITLE = "Find up to 10 more matching contacts for this role.";
export const ADD_MORE_DIALOG_NOTE = "Existing people won't be repeated.";
export const ADD_MORE_CONFIRM_LABEL = "Add up to 10 people";
export const ADD_MORE_CANCEL_LABEL = "Cancel";
export const ADD_MORE_LOADING_LABEL = "Adding new people…";
export const ADD_MORE_EXHAUSTED_MESSAGE = "No more unique people are available for this search.";

// A finished expansion that added nobody. Answered in a centered dialog so the
// People card is never rewritten — and so the button that opened it stays put.
export const ADD_MORE_NO_RESULTS_TITLE = "No more people found";
export const ADD_MORE_NO_RESULTS_BODY =
  "We couldn't find any new people for this search. Nobody was added — try another role or location for this company.";
export const ADD_MORE_NO_RESULTS_CLOSE_LABEL = "Close";

/**
 * Whether the company on screen can be searched again at all: it needs an
 * identity the provider can query — a name, or a domain to fall back on.
 *
 * Deliberately blind to the people currently rendered. A role filter with no
 * rows, an all-invalid email column, a changed email format, a legacy row with
 * no role groups: none of those say anything about whether more people exist to
 * fetch, so none of them may take "Add 10 more" away.
 */
export function canSearchCompanyAgain(
  company: {
    name?: string | null;
    officialDomain?: string | null;
    officialWebsiteDomain?: string | null;
    emailDomain?: string | null;
  } | null
): boolean {
  if (!company) {
    return false;
  }
  return [company.name, company.officialDomain, company.officialWebsiteDomain, company.emailDomain].some((value) =>
    Boolean(value && value.trim())
  );
}

/**
 * Whether the "Add 10 more" button should be shown at all: a READY search whose
 * company can be searched again (canSearchCompanyAgain).
 *
 * Visibility is a property of the SEARCH, never of the rows on the page. Quota,
 * in-flight state, and a provider that has run dry only DISABLE the button or
 * answer with the "no more people" dialog — the user always keeps the control
 * they used to have. Filter/email-status state must never reach this function.
 */
export function shouldShowAddMore(args: {
  view: SelectedSearchView;
  status: ProspectSearchStatus;
  canSearchAgain: boolean;
}): boolean {
  return args.view === "ready" && args.status === "READY" && args.canSearchAgain;
}

/**
 * A reason the visible "Add 10 more" button is disabled, or null when it is
 * actionable. Disabled while an expansion runs (prevents duplicate requests) and
 * when the daily Discover allowance is spent (exempt accounts are never blocked).
 */
export function addMoreDisabledReason(quota: DiscoverQuota | null, expanding: boolean): string | null {
  if (expanding) {
    return ADD_MORE_LOADING_LABEL;
  }
  if (quota && !quota.unlimited && quota.searchesRemaining <= 0) {
    return "You've used today's Discover searches.";
  }
  return null;
}

/** "Searches remaining today: 3", or "Unlimited" for an exempt account. */
export function formatSearchesRemainingLine(quota: DiscoverQuota | null): string {
  if (!quota || quota.unlimited) {
    return "Searches remaining today: Unlimited";
  }
  return `Searches remaining today: ${quota.searchesRemaining}`;
}

/** "Current people: 10" for the confirmation dialog. */
export function formatCurrentPeopleLine(peopleCount: number): string {
  return `Current people: ${Math.max(0, peopleCount)}`;
}

// ---------------------------------------------------------------------------
// "Search this company" (same-company role/location search).
// ---------------------------------------------------------------------------

export const COMPANY_SEARCH_TITLE = "Search this company";
/**
 * Text revealed when the icon-only header trigger expands on hover/focus.
 * Deliberately short — the full name lives in the trigger's aria-label
 * (COMPANY_SEARCH_TITLE), so the button never dominates the header action row.
 */
export const COMPANY_SEARCH_TRIGGER_LABEL = "Search";
/**
 * Decorative helper card shown while the trigger is hovered/focused. It only
 * explains the icon button — the accessible name stays on the button itself.
 */
export const COMPANY_SEARCH_TOOLTIP_TITLE = "Find more people";
export const COMPANY_SEARCH_TOOLTIP_BODY = "Search this company by another role or location.";
export const COMPANY_SEARCH_SUBTITLE = "Add another role or location without leaving this company.";
export const COMPANY_SEARCH_ROLE_LABEL = "Job title";
export const COMPANY_SEARCH_ROLE_PLACEHOLDER = "Software Engineer";
export const COMPANY_SEARCH_LOCATION_LABEL = "Location";
export const COMPANY_SEARCH_LOCATION_PLACEHOLDER = "United States";
export const COMPANY_SEARCH_BUTTON_LABEL = "Search this company";
export const COMPANY_SEARCH_CLOSE_LABEL = "Close company search";
export const COMPANY_SEARCH_LOADING_LABEL = "Searching…";
export const COMPANY_SEARCH_HELPER =
  "Use Add 10 more when you want more people for an existing role and location.";

/**
 * A reason the "Search this company" submit is disabled, or null when it is
 * actionable. Mirrors addMoreDisabledReason: an in-flight search blocks a
 * second submit, and a spent daily allowance blocks new searches (exempt
 * accounts never are). Duplicate rejections are free, but they never reach the
 * backend anyway — the pre-check answers first.
 */
export function companySearchDisabledReason(quota: DiscoverQuota | null, searching: boolean): string | null {
  if (searching) {
    return COMPANY_SEARCH_LOADING_LABEL;
  }
  if (quota && !quota.unlimited && quota.searchesRemaining <= 0) {
    return "You've used today's Discover searches.";
  }
  return null;
}

/** Success notice after the same-company search completes. */
export function companySearchSuccessMessage(jobTitle: string, location: string | null): string {
  const locationLabel = location?.trim() || ANY_LOCATION_LABEL;
  return `New search added: ${jobTitle.trim()} · ${locationLabel}.`;
}

// ---------------------------------------------------------------------------
// Role-targeted "Add 10 more" for the grouped company detail.
// ---------------------------------------------------------------------------

export const ADD_MORE_CHOOSE_ROLE_HINT =
  "This company has several role searches. Choose which role group to extend.";

export type AddMoreCandidateSearch = {
  id: string;
  status: ProspectSearchStatus;
  requestedTitles: string[];
  requestedLocations: string[];
  positionCategories: PositionCategory[];
  createdAt: string;
};

/**
 * Which child search an "Add 10 more" applies to. The backend only ever
 * extends ONE user-owned search, so the target must be unambiguous:
 *  - one ready search → that search;
 *  - an active role tab → the search whose allocated people include that role
 *    group (the current page's search wins a tie, else the newest match);
 *  - "All people" with several role searches (or an unmatchable tab) → the
 *    user must choose — we never guess and never add to every role at once.
 */
export type AddMoreTarget =
  | { kind: "search"; search: AddMoreCandidateSearch }
  | { kind: "choose"; options: AddMoreCandidateSearch[] }
  | { kind: "none" };

/**
 * Collapse the ready child searches into one representative per canonical role
 * group (same normalized roles + locations). Re-searching a company+role a user
 * already searched creates a second ProspectSearch, but both share one role
 * group and must surface as a single option. Within a group the representative
 * is the search the user is currently viewing (so "Add 10 more" extends the page
 * they are on) or else the newest — `ready` is already newest-first. The
 * group's position categories are unioned so an active role tab can still pin a
 * group even when the representative itself didn't carry that category.
 * Extending any sibling is equivalent: they share the same canonical query, so
 * the same shared provider/cache continuation feeds the batch.
 */
function canonicalRoleGroupRepresentatives(
  ready: AddMoreCandidateSearch[],
  currentSearchId: string
): AddMoreCandidateSearch[] {
  const groups = new Map<string, AddMoreCandidateSearch[]>();
  const order: string[] = [];
  for (const search of ready) {
    const key = roleGroupKeyFor(search);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(search);
    } else {
      groups.set(key, [search]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const bucket = groups.get(key)!;
    const representative = bucket.find((search) => search.id === currentSearchId) ?? bucket[0];
    return {
      ...representative,
      positionCategories: [...new Set(bucket.flatMap((search) => search.positionCategories))]
    };
  });
}

export function resolveAddMoreTarget(input: {
  activeCategory: PositionCategory | null;
  /**
   * Canonical key of the active location chip (normalizeRoleGroupToken), "" for
   * the "Any location" chip, or null/undefined when no location filter is
   * active. A set location narrows the candidate groups first, so viewing
   * "Software Engineer · Canada" extends the Canada group — never the US one.
   */
  activeLocationKey?: string | null;
  searches: AddMoreCandidateSearch[];
  currentSearchId: string;
}): AddMoreTarget {
  const ready = input.searches
    .filter((search) => search.status === "READY")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : -1));
  if (ready.length === 0) {
    return { kind: "none" };
  }
  // Dedupe by canonical role group BEFORE deciding — two searches for the same
  // role must never present as two chooser options, and if they are the only
  // group there is nothing to choose.
  let groups = canonicalRoleGroupRepresentatives(ready, input.currentSearchId);
  if (input.activeLocationKey !== null && input.activeLocationKey !== undefined) {
    const inLocation = groups.filter((search) => {
      const tokens = normalizeRoleGroupTokens(search.requestedLocations);
      return input.activeLocationKey === "" ? tokens.length === 0 : tokens.includes(input.activeLocationKey!);
    });
    // A chip that matches no group (stale UI state) falls back to all groups —
    // the user is then asked to choose rather than silently mistargeted.
    if (inLocation.length > 0) {
      groups = inLocation;
    }
  }
  if (groups.length === 1) {
    return { kind: "search", search: groups[0] };
  }
  if (input.activeCategory) {
    const matching = groups.filter((search) => search.positionCategories.includes(input.activeCategory!));
    if (matching.length > 0) {
      return {
        kind: "search",
        search: matching.find((search) => search.id === input.currentSearchId) ?? matching[0]
      };
    }
  }
  return { kind: "choose", options: groups };
}

/**
 * User-facing label for one child search in the role chooser. Includes the
 * group's location ("Software Engineer · United States") whenever one was
 * requested, so the same role in two locations is always distinguishable.
 * Options are already deduped by canonical role+location group upstream.
 */
export function addMoreSearchLabel(search: {
  requestedTitles: string[];
  requestedLocations?: string[];
}): string {
  const roles = search.requestedTitles.length > 0 ? search.requestedTitles.join(", ") : "Any role";
  const locations = (search.requestedLocations ?? []).map((label) => label.trim()).filter(Boolean);
  return locations.length > 0 ? `${roles} · ${locations.join(", ")}` : roles;
}

/**
 * Distinct requested role labels across a company's child searches for the
 * grouped detail header, shown in clean canonical casing — so a legacy row
 * stored as "SOftware Engineer" still renders "Software Engineer".
 */
export function groupedRoleLabels(searches: Array<{ requestedTitles: string[] }>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const search of searches) {
    for (const title of search.requestedTitles) {
      // Same canonical fold used for role-group identity, so "Software Engineer"
      // and "software  engineer" never render as two chips.
      const key = normalizeRoleGroupToken(title);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      labels.push(titleCaseLabel(title));
    }
  }
  return labels;
}
