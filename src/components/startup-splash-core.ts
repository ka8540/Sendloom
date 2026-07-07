// Pure, DOM-free logic + content for the Sendloom startup splash — the
// command-center boot sequence.
//
// The splash is the opening frame of the product: a calm outreach command
// surface powering on. Six workflow modules (the landing page's own vocabulary)
// dock around a central Sendloom core, routing lines link them, and a paced
// send rail runs along the bottom. It covers only the very first paint of the
// public site, then dismisses as soon as the app is interactive and a brief
// minimum has elapsed. Dismissal is driven by *readiness + wall-clock time*,
// never by an animation finishing — so a throttled/hidden tab can't trap it.
//
// This module holds every timing/branching decision so it is unit-testable
// under the repo's node-only vitest setup. No React, no timers, no fetch.

export type SplashPhase =
  | "loading" // overlay visible, boot choreography playing
  | "exiting" // readiness met — playing the short exit (non-blocking)
  | "done"; // removed from the DOM

// The splash holds long enough for the boot to read as complete, but always
// yields to a hard ceiling so it can never get stuck.
export const MIN_VISIBLE_MS = 800;
export const MAX_VISIBLE_MS = 2200;
// Exit duration. Removal is scheduled off a timer (not animationend) so a hidden
// tab that never fires the animation still unmounts the overlay.
export const EXIT_MS = 320;

// ---------------------------------------------------------------------------
// Boot-stage copy. Broad, honest phase labels — never a fake percentage and
// never a claim that the loader is really finding people or sending mail.
// ---------------------------------------------------------------------------

export const SPLASH_STAGES = [
  "Assembling your outreach engine",
  "Connecting leads, messages, and send controls",
  "Opening the command center"
] as const;
export const STAGE_THRESHOLDS_MS = [0, 420, 840] as const;

/** Which stage label to show for an elapsed time (highest threshold reached). */
export function resolveStageIndex(elapsedMs: number): number {
  let index = 0;
  for (let i = 0; i < STAGE_THRESHOLDS_MS.length; i += 1) {
    if (elapsedMs >= STAGE_THRESHOLDS_MS[i]) {
      index = i;
    }
  }
  return index;
}

export function resolveStageLabel(elapsedMs: number): string {
  return SPLASH_STAGES[resolveStageIndex(elapsedMs)];
}

// ---------------------------------------------------------------------------
// Brand + command modules.
// ---------------------------------------------------------------------------

// Full brand, one piece — rendered as a sharp command-center title.
export const BRAND = "SENDLOOM";
// Secondary lockup label; mirrors the landing hero's "outreach operations" line.
export const BRAND_TAGLINE = "Outreach operations";

// The six workflow modules that dock around the core — the landing page's own
// Import → Enrich → Template → Sequence → Send → Track story. Decorative
// labels only, never announced as live actions.
export type CommandModuleKey = "import" | "enrich" | "template" | "sequence" | "send" | "track";

export type CommandModule = {
  key: CommandModuleKey;
  label: string;
  /** Short, honest sublabel shown inside the module panel. */
  detail: string;
};

export const COMMAND_MODULES: readonly CommandModule[] = [
  { key: "import", label: "Import", detail: "Lead list" },
  { key: "enrich", label: "Enrich", detail: "Contact data" },
  { key: "template", label: "Template", detail: "Merge fields" },
  { key: "sequence", label: "Sequence", detail: "Timed steps" },
  { key: "send", label: "Send", detail: "Gmail channel" },
  { key: "track", label: "Track", detail: "Reply loop" }
] as const;

/** Screen-reader label for the whole overlay. */
export const SPLASH_STATUS_LABEL = "Sendloom is loading.";

// ---------------------------------------------------------------------------
// Particles. A fixed sparse set is rendered (deterministic, so SSR and the
// first client render agree); the responsive/reduced-motion caps below decide
// how many actually drift, mirrored by CSS breakpoints in the stylesheet.
// ---------------------------------------------------------------------------

export const PARTICLE_TOTAL = 12;
export const MAX_PARTICLES = 14;
export const MOBILE_BREAKPOINT_PX = 640;
export const TABLET_BREAKPOINT_PX = 1024;

/**
 * How many particles should drift for a viewport. Reduced-motion returns 0 (a
 * static field); otherwise 5 mobile / 8 tablet / 12 desktop, always capped.
 */
export function resolveParticleCount(input: { viewportWidth: number; reducedMotion: boolean }): number {
  if (input.reducedMotion) {
    return 0;
  }
  if (!Number.isFinite(input.viewportWidth) || input.viewportWidth <= 0) {
    return 8;
  }
  if (input.viewportWidth < MOBILE_BREAKPOINT_PX) {
    return 5;
  }
  if (input.viewportWidth < TABLET_BREAKPOINT_PX) {
    return 8;
  }
  return PARTICLE_TOTAL;
}

// ---------------------------------------------------------------------------
// Readiness math.
// ---------------------------------------------------------------------------

/**
 * The readiness rule: dismiss once the app is interactive AND the brief minimum
 * has elapsed. "Ready" is simply "React has mounted" — the real, already
 * server-rendered page is interactive by then; we never wait on fonts, images,
 * analytics, or any network.
 */
export function shouldDismiss(input: { elapsedMs: number; appReady: boolean; minVisibleMs?: number }): boolean {
  const min = input.minVisibleMs ?? MIN_VISIBLE_MS;
  return input.appReady && input.elapsedMs >= min;
}

/** Milliseconds still to wait before the minimum-visible window is satisfied. */
export function resolveRemainingDelayMs(input: { elapsedMs: number; minVisibleMs?: number }): number {
  const min = input.minVisibleMs ?? MIN_VISIBLE_MS;
  return Math.max(0, min - input.elapsedMs);
}
