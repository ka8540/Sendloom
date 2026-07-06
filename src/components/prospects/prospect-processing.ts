// Pure, DOM-free logic for the Discover search "processing" experience.
//
// The processing UI is a display of AUTHORITATIVE backend state — the Discover
// pipeline (resolve company → find people → classify roles → infer email
// pattern → ready) runs server-side and records each transition on the
// ProspectSearch row. This module is where every branching/mapping decision
// lives so it can be unit-tested under the repo's node-only vitest setup. No
// React, no timers, no fetch: the hook/component wire these helpers to the DOM.
//
// Progress is STAGE-BASED and truthful: the ring only advances when the backend
// reports the next status, and it never reads 100% until status === "READY".
// A decorative shimmer conveys "still working" WITHIN a stage without inventing
// a fine-grained percentage the backend does not provide.

import type { ProspectSearchStatus } from "@/components/prospects/prospect-graphql";

// ---------------------------------------------------------------------------
// UI state model — one explicit phase, never a soup of booleans.
// ---------------------------------------------------------------------------

export type ProcessingPhase =
  | "INITIALIZING" // a DRAFT that has not been started (or is being started)
  | "RUNNING" // the backend pipeline is advancing through its stages
  | "RECONNECTING" // the browser is offline / a status sync is failing transiently
  | "COMPLETED" // status === READY
  | "FAILED" // status === FAILED
  | "CANCELLED"; // status === CANCELED

export type ConnectionState = "online" | "reconnecting";

// ---------------------------------------------------------------------------
// Stage model. The ordered pipeline statuses plus the terminal READY stage,
// each with product-safe copy. Order IS the progression, so index === how far
// the backend has advanced. READY is the last (completion) stage.
// ---------------------------------------------------------------------------

export type ProcessingStage = {
  status: Extract<
    ProspectSearchStatus,
    "RESOLVING_COMPANY" | "SEARCHING_PEOPLE" | "CLASSIFYING_POSITIONS" | "INFERRING_EMAIL_PATTERN" | "READY"
  >;
  /** Stable key for React lists / data attributes. */
  key: string;
  /** Short label shown in the stage trail. */
  label: string;
  /** One concise line describing what Sendloom is doing at this stage. */
  detail: string;
};

export const PROCESSING_STAGES: readonly ProcessingStage[] = [
  {
    status: "RESOLVING_COMPANY",
    key: "resolving",
    label: "Resolving company details",
    detail: "Confirming the company identity, domain, and web presence."
  },
  {
    status: "SEARCHING_PEOPLE",
    key: "finding",
    label: "Finding relevant professionals",
    detail: "Matching people by the roles and locations you asked for."
  },
  {
    status: "CLASSIFYING_POSITIONS",
    key: "organizing",
    label: "Organizing contact intelligence",
    detail: "Grouping people by role so the results stay easy to scan."
  },
  {
    status: "INFERRING_EMAIL_PATTERN",
    key: "patterns",
    label: "Preparing inferred email patterns",
    detail: "Inferring the company email domain and address format."
  },
  {
    status: "READY",
    key: "finalizing",
    label: "Finalizing your results",
    detail: "Assembling your outreach-ready contact list."
  }
] as const;

export const PROCESSING_STAGE_COUNT = PROCESSING_STAGES.length;

const STAGE_STATUSES: readonly ProspectSearchStatus[] = PROCESSING_STAGES.map((stage) => stage.status);

/** The statuses that mean the backend pipeline is actively advancing. */
const ACTIVE_PIPELINE_STATUSES: ReadonlySet<ProspectSearchStatus> = new Set([
  "RESOLVING_COMPANY",
  "SEARCHING_PEOPLE",
  "CLASSIFYING_POSITIONS",
  "INFERRING_EMAIL_PATTERN"
]);

const TERMINAL_STATUSES: ReadonlySet<ProspectSearchStatus> = new Set(["READY", "FAILED", "CANCELED"]);

export function isTerminalStatus(status: ProspectSearchStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True while the backend is mid-pipeline (excludes DRAFT and terminal states). */
export function isActivePipelineStatus(status: ProspectSearchStatus): boolean {
  return ACTIVE_PIPELINE_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Phase resolution — the single central map from backend status + client
// connectivity to the explicit UI phase. Impossible combinations (e.g.
// "completed and reconnecting") can't occur because terminal status wins.
// ---------------------------------------------------------------------------

export function resolveProcessingPhase(input: {
  status: ProspectSearchStatus;
  /** A start request the user just triggered is in flight (pre-first-status). */
  starting: boolean;
  /** navigator.onLine — false means the browser has no connectivity. */
  online: boolean;
}): ProcessingPhase {
  // Terminal backend truth always wins, even while offline: if the server said
  // READY/FAILED/CANCELED, that is the real, committed outcome.
  if (input.status === "READY") {
    return "COMPLETED";
  }
  if (input.status === "FAILED") {
    return "FAILED";
  }
  if (input.status === "CANCELED") {
    return "CANCELLED";
  }
  // Non-terminal + offline → reconnecting. The operation is NOT failed; the
  // client simply can't observe it right now.
  if (!input.online) {
    return "RECONNECTING";
  }
  if (input.status === "DRAFT") {
    return input.starting ? "RUNNING" : "INITIALIZING";
  }
  // Any active pipeline status.
  return "RUNNING";
}

export function resolveConnectionState(online: boolean): ConnectionState {
  return online ? "online" : "reconnecting";
}

// ---------------------------------------------------------------------------
// Stage progress. index === how many stages the backend has entered minus one;
// percent is stage-derived and NEVER reaches 100 until status === "READY".
// ---------------------------------------------------------------------------

export type StageProgress = {
  /** -1 before the first stage (DRAFT/failed/canceled), else 0..count-1. */
  index: number;
  total: number;
  /** Honest, stage-derived 0..100. 0 before start; 100 only at READY. */
  percent: number;
  /** Human "Step 2 of 5", or null when there is no active stage. */
  stepLabel: string | null;
  stage: ProcessingStage | null;
};

export function resolveStageIndex(status: ProspectSearchStatus): number {
  return STAGE_STATUSES.indexOf(status);
}

export function resolveStageProgress(status: ProspectSearchStatus): StageProgress {
  const total = PROCESSING_STAGE_COUNT;
  if (status === "READY") {
    const stage = PROCESSING_STAGES[total - 1];
    return { index: total - 1, total, percent: 100, stepLabel: `Step ${total} of ${total}`, stage };
  }
  const index = resolveStageIndex(status);
  if (index < 0) {
    // DRAFT / FAILED / CANCELED: no active pipeline stage.
    return { index: -1, total, percent: 0, stepLabel: null, stage: null };
  }
  // A status of stage `index` means stages [0..index] have been ENTERED. The
  // ring fills to (index + 1) / total — stage-based, backend-backed, and capped
  // below 100 because READY is handled above.
  const percent = Math.min(99, Math.round(((index + 1) / total) * 100));
  return { index, total, percent, stepLabel: `Step ${index + 1} of ${total}`, stage: PROCESSING_STAGES[index] };
}

/** Per-stage status for the vertical stage trail. */
export type StageState = "done" | "active" | "pending";

export function resolveStageStates(status: ProspectSearchStatus): StageState[] {
  const progress = resolveStageProgress(status);
  return PROCESSING_STAGES.map((_stage, index) => {
    if (status === "READY") {
      return "done";
    }
    if (progress.index < 0) {
      return "pending";
    }
    if (index < progress.index) {
      return "done";
    }
    if (index === progress.index) {
      return "active";
    }
    return "pending";
  });
}

// ---------------------------------------------------------------------------
// Polling cadence. Foreground uses a calm interval; a hidden tab polls far less
// often (it only needs to be roughly current for the reconcile-on-return); and
// transient sync errors back off exponentially. Offline is handled by the
// caller (it waits for the `online` event instead of polling into the void).
// ---------------------------------------------------------------------------

export const PROCESSING_POLL_INTERVAL_MS = 2500;
export const HIDDEN_POLL_INTERVAL_MS = 15000;
export const POLL_BACKOFF_CAP_MS = 30000;

/** Exponential backoff: base, 2×, 4×, … capped. errorCount 0 → base. */
export function nextBackoffMs(errorCount: number, base: number, cap: number): number {
  if (errorCount <= 0) {
    return base;
  }
  return Math.min(cap, base * 2 ** errorCount);
}

/**
 * The delay before the next status sync. A hidden tab uses a long interval; a
 * run of transient errors backs off from whichever base applies. The result is
 * always ≥ the applicable base and ≤ the cap.
 */
export function resolvePollDelayMs(input: { hidden: boolean; errorCount: number }): number {
  const base = input.hidden ? HIDDEN_POLL_INTERVAL_MS : PROCESSING_POLL_INTERVAL_MS;
  return nextBackoffMs(input.errorCount, base, POLL_BACKOFF_CAP_MS);
}

// ---------------------------------------------------------------------------
// Particle budget. CSS-only decorative particles, capped hard and reduced on
// small viewports; reduced-motion renders a static field (count 0 = no drift).
// ---------------------------------------------------------------------------

export const MAX_PARTICLES = 18;
export const MOBILE_BREAKPOINT_PX = 640;
export const TABLET_BREAKPOINT_PX = 1024;

export function resolveParticleCount(input: { viewportWidth: number; reducedMotion: boolean }): number {
  if (input.reducedMotion) {
    return 0;
  }
  if (!Number.isFinite(input.viewportWidth) || input.viewportWidth <= 0) {
    return 12;
  }
  if (input.viewportWidth < MOBILE_BREAKPOINT_PX) {
    return 8;
  }
  if (input.viewportWidth < TABLET_BREAKPOINT_PX) {
    return 12;
  }
  return MAX_PARTICLES;
}

// ---------------------------------------------------------------------------
// Document title. Updated once per meaningful phase transition — never spammed.
// ---------------------------------------------------------------------------

export function resolveDocumentTitle(phase: ProcessingPhase): string | null {
  switch (phase) {
    case "RUNNING":
    case "RECONNECTING":
      return "Processing… · Sendloom";
    case "COMPLETED":
      return "Ready · Sendloom";
    case "FAILED":
      return "Action needed · Sendloom";
    case "INITIALIZING":
    case "CANCELLED":
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Product copy. Kept here (not inline JSX) so wording is testable and never
// leaks backend/debug terminology.
// ---------------------------------------------------------------------------

export const PROCESSING_HEADLINE = "Preparing your outreach workspace";
export const INITIALIZING_HEADLINE = "Ready to build this search";
export const COMPLETED_HEADLINE = "Your results are ready";
export const RECONNECTING_HEADLINE = "Reconnecting…";

/** The reassurance that this task is safe to leave — true because the pipeline
 * runs server-side and is reconciled from durable state on return. */
export const BACKGROUND_REASSURANCE = "You can leave this tab — Sendloom will keep working in the background.";
export const RECONNECTING_REASSURANCE =
  "Connection paused. Your search may still be running — we'll reconnect automatically.";

export function resolveHeadline(phase: ProcessingPhase): string {
  switch (phase) {
    case "INITIALIZING":
      return INITIALIZING_HEADLINE;
    case "COMPLETED":
      return COMPLETED_HEADLINE;
    case "RECONNECTING":
      return RECONNECTING_HEADLINE;
    case "RUNNING":
    default:
      return PROCESSING_HEADLINE;
  }
}

/**
 * A single polite live-region sentence describing the current state for a
 * screen reader. Deliberately coarse (stage-level, not per-percent) so it never
 * chatters, and it always announces terminal outcomes.
 */
export function describeProcessingStatus(input: {
  phase: ProcessingPhase;
  status: ProspectSearchStatus;
  companyName?: string | null;
}): string {
  const company = input.companyName?.trim();
  const forCompany = company ? ` for ${company}` : "";
  switch (input.phase) {
    case "INITIALIZING":
      return `This search${forCompany} is ready to start.`;
    case "COMPLETED":
      return `Your results${forCompany} are ready.`;
    case "FAILED":
      return `This search${forCompany} could not be completed.`;
    case "CANCELLED":
      return `This search${forCompany} was canceled.`;
    case "RECONNECTING":
      return "Connection paused. Reconnecting to your running search.";
    case "RUNNING":
    default: {
      const progress = resolveStageProgress(input.status);
      if (!progress.stage) {
        return `Starting your search${forCompany}.`;
      }
      return `${progress.stepLabel}: ${progress.stage.label}${forCompany}.`;
    }
  }
}

/** aria-busy is true while the operation is not in a settled terminal state. */
export function resolveAriaBusy(phase: ProcessingPhase): boolean {
  return phase === "INITIALIZING" || phase === "RUNNING" || phase === "RECONNECTING";
}

/** Whether the status-sync poller should keep running for this phase. */
export function shouldPollForPhase(phase: ProcessingPhase): boolean {
  return phase === "RUNNING" || phase === "RECONNECTING";
}
