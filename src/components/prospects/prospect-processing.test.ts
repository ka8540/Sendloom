import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BACKGROUND_REASSURANCE,
  HIDDEN_POLL_INTERVAL_MS,
  MAX_PARTICLES,
  PROCESSING_POLL_INTERVAL_MS,
  PROCESSING_STAGES,
  POLL_BACKOFF_CAP_MS,
  describeProcessingStatus,
  isActivePipelineStatus,
  isTerminalStatus,
  nextBackoffMs,
  resolveAriaBusy,
  resolveDocumentTitle,
  resolveParticleCount,
  resolvePollDelayMs,
  resolveProcessingPhase,
  resolveStageProgress,
  resolveStageStates,
  shouldPollForPhase
} from "@/components/prospects/prospect-processing";
import type { ProspectSearchStatus } from "@/components/prospects/prospect-graphql";

// The experience + hook are "use client" React modules; in the node test env we
// verify their contract through the pure logic above plus source assertions —
// the same style the rest of the suite uses for client components.
const EXPERIENCE_SOURCE = readFileSync("src/components/prospects/prospect-processing-experience.tsx", "utf8");
const HOOK_SOURCE = readFileSync("src/components/prospects/use-prospect-processing-sync.ts", "utf8");
const MODULE_SOURCE = readFileSync("src/components/prospects/prospect-processing.ts", "utf8");
const CSS_SOURCE = readFileSync("src/components/prospects/prospect-processing.module.css", "utf8");
const GRAPHQL_SOURCE = readFileSync("src/components/prospects/prospect-graphql.ts", "utf8");
const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");

const ACTIVE_STATUSES: ProspectSearchStatus[] = [
  "RESOLVING_COMPANY",
  "SEARCHING_PEOPLE",
  "CLASSIFYING_POSITIONS",
  "INFERRING_EMAIL_PATTERN"
];

// ---------------------------------------------------------------------------
// Background execution & synchronization
// ---------------------------------------------------------------------------

describe("background execution & synchronization", () => {
  it("(1) reconcile is status-only and never starts duplicate work on mount", () => {
    // The processing sync hook's reconcile must only READ status. The detail
    // view's status reconcile uses the lightweight status query, never a
    // process/create mutation.
    expect(DETAIL_SOURCE).toMatch(/syncSearchStatus[\s\S]*?PROSPECT_SEARCH_STATUS_QUERY/);
    const syncBlock = DETAIL_SOURCE.slice(
      DETAIL_SOURCE.indexOf("const syncSearchStatus"),
      DETAIL_SOURCE.indexOf("const handleProcess")
    );
    expect(syncBlock).not.toContain("PROCESS_SEARCH_MUTATION");
    expect(syncBlock).not.toContain("CREATE_SEARCH_MUTATION");
    // Mounting only reads detail; processing starts on an explicit handler.
    expect(DETAIL_SOURCE).toMatch(/useEffect\([\s\S]*?void loadDetail\(\);[\s\S]*?\}, \[searchId\]\)/);
  });

  it("(2) progress is derived from the backend status, stage by stage", () => {
    expect(resolveStageProgress("RESOLVING_COMPANY").index).toBe(0);
    expect(resolveStageProgress("SEARCHING_PEOPLE").index).toBe(1);
    expect(resolveStageProgress("CLASSIFYING_POSITIONS").index).toBe(2);
    expect(resolveStageProgress("INFERRING_EMAIL_PATTERN").index).toBe(3);
    // The component reads search.status; it does not compute progress from time.
    expect(EXPERIENCE_SOURCE).toContain("resolveStageProgress(status)");
  });

  it("(3) a hidden tab only changes the poll cadence — it never cancels", () => {
    expect(resolvePollDelayMs({ hidden: true, errorCount: 0 })).toBe(HIDDEN_POLL_INTERVAL_MS);
    expect(resolvePollDelayMs({ hidden: false, errorCount: 0 })).toBe(PROCESSING_POLL_INTERVAL_MS);
    expect(HIDDEN_POLL_INTERVAL_MS).toBeGreaterThan(PROCESSING_POLL_INTERVAL_MS);
    // The hook never calls a cancel/abort of the operation on hide.
    expect(HOOK_SOURCE).not.toMatch(/cancel|abort/i);
  });

  it("(4) returning to the tab triggers immediate reconciliation", () => {
    expect(HOOK_SOURCE).toContain('addEventListener("visibilitychange"');
    expect(HOOK_SOURCE).toMatch(/visibilityState === "visible"[\s\S]*?reconcileNow\(\)/);
  });

  it("(5) window focus triggers a safe status refresh", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("focus"');
    expect(HOOK_SOURCE).toMatch(/onFocus = \(\) => \{[\s\S]*?reconcileNow\(\)/);
  });

  it("(6) offline does not mark the job failed — it becomes RECONNECTING", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(resolveProcessingPhase({ status, starting: false, online: false })).toBe("RECONNECTING");
    }
    expect(resolveProcessingPhase({ status: "DRAFT", starting: true, online: false })).toBe("RECONNECTING");
    // A transient sync failure returns false (backoff), never a FAILED status.
    const syncBlock = DETAIL_SOURCE.slice(
      DETAIL_SOURCE.indexOf("const syncSearchStatus"),
      DETAIL_SOURCE.indexOf("const handleProcess")
    );
    expect(syncBlock).toMatch(/return false/);
    expect(syncBlock).not.toContain('"FAILED"');
  });

  it("(7) reconnection (online event) reloads the latest status", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("online"');
    expect(HOOK_SOURCE).toMatch(/onOnline = \(\) => \{[\s\S]*?setOnline\(true\)[\s\S]*?reconcileNow\(\)/);
  });

  it("(8) completion while hidden redirects correctly after return", () => {
    // On the READY transition the reconcile loads the full detail once, and the
    // visibility handler forces that reconcile immediately on return.
    const syncBlock = DETAIL_SOURCE.slice(
      DETAIL_SOURCE.indexOf("const syncSearchStatus"),
      DETAIL_SOURCE.indexOf("const handleProcess")
    );
    expect(syncBlock).toMatch(/becameReady[\s\S]*?loadDetail/);
    expect(HOOK_SOURCE).toMatch(/onPageShow = \(\) => \{[\s\S]*?reconcileNow\(\)/);
  });

  it("(9) refresh reconnects to the same job by route id (no new op)", () => {
    // The detail page loads purely from the route searchId, and the status query
    // is keyed on that same id.
    expect(DETAIL_SOURCE).toContain("PROSPECT_SEARCH_STATUS_QUERY, { id: searchId }");
    expect(GRAPHQL_SOURCE).toContain("query ProspectSearchStatus($id: ID!)");
  });

  it("(10) polling stops after completion", () => {
    expect(shouldPollForPhase("COMPLETED")).toBe(false);
    expect(isTerminalStatus("READY")).toBe(true);
  });

  it("(11) polling stops after terminal failure", () => {
    expect(shouldPollForPhase("FAILED")).toBe(false);
    expect(shouldPollForPhase("CANCELLED")).toBe(false);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("CANCELED")).toBe(true);
  });

  it("(12) timers and subscriptions are cleaned up on unmount", () => {
    expect(HOOK_SOURCE).toContain("clearTimeout");
    expect(HOOK_SOURCE).toContain('removeEventListener("visibilitychange"');
    expect(HOOK_SOURCE).toContain('removeEventListener("focus"');
    expect(HOOK_SOURCE).toContain('removeEventListener("online"');
    expect(HOOK_SOURCE).toContain('removeEventListener("offline"');
    expect(HOOK_SOURCE).toContain('removeEventListener("pageshow"');
    expect(HOOK_SOURCE).toMatch(/mountedRef\.current = false/);
  });
});

// ---------------------------------------------------------------------------
// UI state model
// ---------------------------------------------------------------------------

describe("UI state model", () => {
  it("(phase map) resolves every backend status + connectivity to one phase", () => {
    expect(resolveProcessingPhase({ status: "DRAFT", starting: false, online: true })).toBe("INITIALIZING");
    expect(resolveProcessingPhase({ status: "DRAFT", starting: true, online: true })).toBe("RUNNING");
    expect(resolveProcessingPhase({ status: "RESOLVING_COMPANY", starting: false, online: true })).toBe("RUNNING");
    expect(resolveProcessingPhase({ status: "READY", starting: false, online: true })).toBe("COMPLETED");
    expect(resolveProcessingPhase({ status: "FAILED", starting: false, online: true })).toBe("FAILED");
    expect(resolveProcessingPhase({ status: "CANCELED", starting: false, online: true })).toBe("CANCELLED");
    // Terminal truth wins even offline (a committed result is real).
    expect(resolveProcessingPhase({ status: "READY", starting: false, online: false })).toBe("COMPLETED");
    expect(resolveProcessingPhase({ status: "FAILED", starting: false, online: false })).toBe("FAILED");
  });

  it("(13) initializing state offers an explicit start", () => {
    expect(EXPERIENCE_SOURCE).toMatch(/initializing[\s\S]*?onClick=\{onStart\}/);
    expect(EXPERIENCE_SOURCE).toContain("Start search");
  });

  it("(14) the running stage renders its label + honest step counter", () => {
    const progress = resolveStageProgress("SEARCHING_PEOPLE");
    expect(progress.stepLabel).toBe("Step 2 of 5");
    expect(progress.stage?.label).toBe("Finding relevant professionals");
    expect(EXPERIENCE_SOURCE).toContain("stageProgress.stepLabel");
  });

  it("(15) a real, backend-derived percentage renders for an active stage", () => {
    // The number shown is stage-derived from committed backend status — not a
    // fabricated timer value.
    expect(resolveStageProgress("RESOLVING_COMPANY").percent).toBe(20);
    expect(resolveStageProgress("INFERRING_EMAIL_PATTERN").percent).toBe(80);
    expect(EXPERIENCE_SOURCE).toMatch(/\{percent\}%/);
  });

  it("(16) unknown in-stage progress uses an indeterminate presentation", () => {
    // Within a stage there is no fine-grained number, so a decorative sheen +
    // the core mark convey activity without inventing a percentage.
    expect(CSS_SOURCE).toContain("meterSheen");
    expect(EXPERIENCE_SOURCE).toContain("coreMark");
  });

  it("(17) completion renders a settled, checkmark state", () => {
    expect(EXPERIENCE_SOURCE).toContain("checkPath");
    expect(EXPERIENCE_SOURCE).toMatch(/complete = phase === "COMPLETED"/);
    expect(resolveStageProgress("READY").percent).toBe(100);
  });

  it("(18) failure renders a dedicated failure state", () => {
    expect(EXPERIENCE_SOURCE).toContain("function FailureState");
    expect(EXPERIENCE_SOURCE).toContain("formatSearchError(search)");
  });

  it("(19) retry uses the existing safe (idempotent) process handler", () => {
    // The failure Retry calls onStart, which the detail view wires to
    // handleProcess — the same idempotency-keyed, quota-safe path.
    expect(EXPERIENCE_SOURCE).toMatch(/onRetry=\{onStart\}/);
    expect(DETAIL_SOURCE).toMatch(/onStart=\{handleProcess\}/);
    expect(DETAIL_SOURCE).toContain("idempotencyKey");
  });

  it("(20) no native browser dialogs are used", () => {
    expect(EXPERIENCE_SOURCE).not.toMatch(/\b(?:window|globalThis)?\.?(?:confirm|alert|prompt)\s*\(/);
    expect(HOOK_SOURCE).not.toMatch(/\b(?:window|globalThis)?\.?(?:confirm|alert|prompt)\s*\(/);
  });

  it("(21) completion reveals results in place — no client-side route push", () => {
    // Completion is a same-route transition to the results view; the experience
    // never navigates, so double-navigation is impossible.
    expect(EXPERIENCE_SOURCE).not.toContain("router.push");
    expect(EXPERIENCE_SOURCE).not.toContain("router.replace");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("(22) the status container is a polite live region", () => {
    expect(EXPERIENCE_SOURCE).toMatch(/role="status" aria-live="polite"/);
  });

  it("(23) busy state is exposed via aria-busy while unsettled", () => {
    expect(EXPERIENCE_SOURCE).toContain("aria-busy={busy}");
    expect(resolveAriaBusy("RUNNING")).toBe(true);
    expect(resolveAriaBusy("RECONNECTING")).toBe(true);
    expect(resolveAriaBusy("INITIALIZING")).toBe(true);
    expect(resolveAriaBusy("COMPLETED")).toBe(false);
    expect(resolveAriaBusy("FAILED")).toBe(false);
  });

  it("(24) decorative particles/backdrop are hidden from assistive tech", () => {
    expect(EXPERIENCE_SOURCE).toMatch(/className=\{styles\.backdrop\} aria-hidden="true"/);
    expect(EXPERIENCE_SOURCE).toMatch(/className=\{styles\.trail\} aria-hidden="true"/);
  });

  it("(25) reduced-motion disables decorative movement", () => {
    expect(CSS_SOURCE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS_SOURCE).toMatch(/animation: none !important/);
    expect(EXPERIENCE_SOURCE).toContain("usePrefersReducedMotion");
    // A static field renders 0 drifting particles.
    expect(resolveParticleCount({ viewportWidth: 1440, reducedMotion: true })).toBe(0);
  });

  it("(26) keyboard focus stays visible on interactive controls", () => {
    expect(CSS_SOURCE).toMatch(/:focus-visible/);
    expect(CSS_SOURCE).toMatch(/outline: 2px solid var\(--proc-accent\)/);
  });

  it("(27) failure actions are keyboard accessible (native button + link)", () => {
    expect(EXPERIENCE_SOURCE).toMatch(/<button type="button" className=\{styles\.primaryButton\} onClick=\{onRetry\}/);
    expect(EXPERIENCE_SOURCE).toMatch(/<Link href=\{"\/prospects" as Route\}/);
  });

  it("announces coarse, stage-level status (never per-percent chatter)", () => {
    expect(describeProcessingStatus({ phase: "RUNNING", status: "SEARCHING_PEOPLE", companyName: "Acme" })).toBe(
      "Step 2 of 5: Finding relevant professionals for Acme."
    );
    expect(describeProcessingStatus({ phase: "COMPLETED", status: "READY" })).toContain("ready");
    expect(describeProcessingStatus({ phase: "FAILED", status: "FAILED" })).toContain("could not be completed");
    // No percentage appears in the announced text.
    expect(describeProcessingStatus({ phase: "RUNNING", status: "RESOLVING_COMPANY" })).not.toMatch(/\d+%/);
  });
});

// ---------------------------------------------------------------------------
// Performance-oriented behavior
// ---------------------------------------------------------------------------

describe("performance-oriented behavior", () => {
  it("(28) particle count is hard-capped", () => {
    expect(MAX_PARTICLES).toBeLessThanOrEqual(20);
    for (const width of [320, 640, 1024, 1440, 3840]) {
      expect(resolveParticleCount({ viewportWidth: width, reducedMotion: false })).toBeLessThanOrEqual(MAX_PARTICLES);
    }
  });

  it("(29) mobile uses fewer particles than desktop", () => {
    const mobile = resolveParticleCount({ viewportWidth: 375, reducedMotion: false });
    const tablet = resolveParticleCount({ viewportWidth: 800, reducedMotion: false });
    const desktop = resolveParticleCount({ viewportWidth: 1440, reducedMotion: false });
    expect(mobile).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(desktop);
    expect(mobile).toBe(8);
  });

  it("(30) hidden-tab decorative animation can pause without touching progress", () => {
    expect(EXPERIENCE_SOURCE).toContain("useDocumentHidden");
    expect(EXPERIENCE_SOURCE).toMatch(/data-paused=\{documentHidden \? "true" : "false"\}/);
    expect(CSS_SOURCE).toMatch(/data-paused="true"\][\s\S]*?animation-play-state: paused/);
  });

  it("(31) no animation primitive controls backend progress", () => {
    // The pure/decision layer contains no timers or animation frames.
    expect(MODULE_SOURCE).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
    // The visual composition does not use rAF or a repainting canvas.
    expect(EXPERIENCE_SOURCE).not.toMatch(/requestAnimationFrame|<canvas|WebGL|new Worker/);
  });

  it("(32) reconcile starts no provider/AI/API operation", () => {
    // The status poller only asks for status; it never triggers the paid
    // pipeline, add-more, or email-format discovery.
    expect(HOOK_SOURCE).not.toContain("MUTATION");
    const syncBlock = DETAIL_SOURCE.slice(
      DETAIL_SOURCE.indexOf("const syncSearchStatus"),
      DETAIL_SOURCE.indexOf("const handleProcess")
    );
    expect(syncBlock).not.toMatch(/MUTATION/);
  });

  it("(33) no repeated status requests after a terminal state", () => {
    // The hook guards each sync against a terminal status and stops scheduling.
    expect(HOOK_SOURCE).toMatch(/isTerminalStatus\(statusRef\.current\)/);
    expect(HOOK_SOURCE).toMatch(/if \(!shouldPollForPhase\(phase\)\)/);
    expect(shouldPollForPhase("COMPLETED")).toBe(false);
    expect(shouldPollForPhase("FAILED")).toBe(false);
  });

  it("backoff grows exponentially and is capped", () => {
    expect(nextBackoffMs(0, 2500, POLL_BACKOFF_CAP_MS)).toBe(2500);
    expect(nextBackoffMs(1, 2500, POLL_BACKOFF_CAP_MS)).toBe(5000);
    expect(nextBackoffMs(2, 2500, POLL_BACKOFF_CAP_MS)).toBe(10000);
    expect(nextBackoffMs(10, 2500, POLL_BACKOFF_CAP_MS)).toBe(POLL_BACKOFF_CAP_MS);
  });
});

// ---------------------------------------------------------------------------
// Truthful progress & stage model
// ---------------------------------------------------------------------------

describe("truthful progress", () => {
  it("never reaches 100% until the backend reports READY", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(resolveStageProgress(status).percent).toBeLessThan(100);
    }
    expect(resolveStageProgress("DRAFT").percent).toBe(0);
    expect(resolveStageProgress("READY").percent).toBe(100);
  });

  it("has exactly five ordered stages ending in READY", () => {
    expect(PROCESSING_STAGES).toHaveLength(5);
    expect(PROCESSING_STAGES[PROCESSING_STAGES.length - 1].status).toBe("READY");
  });

  it("maps stage states to done/active/pending in order", () => {
    expect(resolveStageStates("SEARCHING_PEOPLE")).toEqual(["done", "active", "pending", "pending", "pending"]);
    expect(resolveStageStates("READY")).toEqual(["done", "done", "done", "done", "done"]);
    expect(resolveStageStates("DRAFT")).toEqual(["pending", "pending", "pending", "pending", "pending"]);
  });

  it("classifies active vs terminal statuses", () => {
    expect(isActivePipelineStatus("RESOLVING_COMPANY")).toBe(true);
    expect(isActivePipelineStatus("DRAFT")).toBe(false);
    expect(isActivePipelineStatus("READY")).toBe(false);
  });

  it("updates the document title without spamming", () => {
    expect(resolveDocumentTitle("RUNNING")).toBe("Processing… · Sendloom");
    expect(resolveDocumentTitle("COMPLETED")).toBe("Ready · Sendloom");
    expect(resolveDocumentTitle("INITIALIZING")).toBeNull();
    // The effect only writes on a real change and restores the original title.
    expect(EXPERIENCE_SOURCE).toMatch(/document\.title !== next/);
    expect(EXPERIENCE_SOURCE).toContain("originalTitleRef");
  });
});

// ---------------------------------------------------------------------------
// Regression / integration guards
// ---------------------------------------------------------------------------

describe("regression guards", () => {
  it("(34) the correct destination is preserved on completion + failure", () => {
    // Completion loads the same search's detail (active category preserved);
    // the failure escape hatch returns to the Discover list.
    const syncBlock = DETAIL_SOURCE.slice(
      DETAIL_SOURCE.indexOf("const syncSearchStatus"),
      DETAIL_SOURCE.indexOf("const handleProcess")
    );
    expect(syncBlock).toContain("loadDetail({ category: activeCategory })");
    expect(EXPERIENCE_SOURCE).toContain('href={"/prospects" as Route}');
  });

  it("(35) existing backend task behavior is intact (same mutation + idempotency)", () => {
    // The start path still calls processProspectSearch with the idempotency key;
    // only keepalive was added so it survives tab close.
    expect(DETAIL_SOURCE).toContain("PROCESS_SEARCH_MUTATION");
    expect(DETAIL_SOURCE).toMatch(/PROCESS_SEARCH_MUTATION,\s*\{ id: search\.id, idempotencyKey \},\s*\{ keepalive: true \}/);
  });

  it("(36/37) colours come only from shared theme tokens (dark + light)", () => {
    // No hardcoded hex/rgb colours — every colour is a CSS var, so both themes
    // resolve from globals.css.
    expect(CSS_SOURCE).toContain("var(--accent)");
    expect(CSS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS_SOURCE).not.toMatch(/\brgb\(/);
  });

  it("(38) mobile layout is handled", () => {
    expect(CSS_SOURCE).toContain("@media (max-width: 560px)");
    expect(CSS_SOURCE).toContain("env(safe-area-inset-bottom)");
  });

  it("(39) desktop layout is a balanced two-column composition", () => {
    expect(CSS_SOURCE).toMatch(/grid-template-columns: minmax\(0, 1\.05fr\) minmax\(0, 1fr\)/);
  });

  it("keepalive is available on the shared GraphQL client", () => {
    expect(GRAPHQL_SOURCE).toContain("keepalive?: boolean");
    expect(GRAPHQL_SOURCE).toContain("keepalive: options.keepalive");
  });

  it("reassurance copy is truthful about background execution", () => {
    expect(BACKGROUND_REASSURANCE).toMatch(/leave this tab/i);
    expect(EXPERIENCE_SOURCE).toContain("BACKGROUND_REASSURANCE");
  });
});
