// Pure presentation helpers for the Prospect Graph dashboard. No React / no DOM
// imports here on purpose: this is where the page's branching logic lives so it
// can be unit-tested under the project's node-only vitest setup.

import type {
  ConfidenceLevel,
  EmailCandidateStatus,
  PersonNode,
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
