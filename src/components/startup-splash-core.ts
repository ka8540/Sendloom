// Pure, DOM-free logic for the Sendloom startup splash — "The Outreach Loom".
//
// The splash is a cinematic boot transition, NOT a backend job: it covers the
// very first paint of the public site, plays a short designed sequence, then
// dismisses as soon as the app is interactive and a brief minimum has elapsed.
// Dismissal is driven by *readiness + wall-clock time*, never by an animation
// finishing — so a throttled/hidden tab can't trap it.
//
// This module holds every timing/branching decision so it is unit-testable under
// the repo's node-only vitest setup. No React, no timers, no fetch.

export type SplashPhase =
  | "loading" // overlay visible, cinematic assembly playing
  | "exiting" // readiness met — playing the short exit (non-blocking)
  | "done"; // removed from the DOM

// The splash holds long enough for the assembly to read as complete, but always
// yields to a hard ceiling so it can never get stuck.
export const MIN_VISIBLE_MS = 900;
export const MAX_VISIBLE_MS = 2600;
// Exit duration. Removal is scheduled off a timer (not animationend) so a hidden
// tab that never fires the animation still unmounts the overlay.
export const EXIT_MS = 420;

// ---------------------------------------------------------------------------
// Cinematic stage copy. Broad, honest phase labels — never a fake percentage and
// never a claim that the loader is really finding people or sending mail.
// ---------------------------------------------------------------------------

export const SPLASH_STAGES = [
  "Organizing the outreach flow",
  "Connecting leads, messages, and sends",
  "Ready for controlled outreach"
] as const;
export const STAGE_THRESHOLDS_MS = [0, 420, 820] as const;

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

// The brand workflow the signal system tells the story of — the landing page's
// own vocabulary (Import → Enrich → Template → Sequence → Send → Track).
// Decorative labels only — never announced as live actions. Mobile keeps
// IMPORT / ENRICH / SEND / TRACK (the others are hidden by CSS).
export const WORKFLOW_STEPS = ["IMPORT", "ENRICH", "TEMPLATE", "SEQUENCE", "SEND", "TRACK"] as const;

// The wordmark is split so SEND reads solid and LOOM reads constructed/outlined.
export const BRAND_LEAD = "SEND";
export const BRAND_TAIL = "LOOM";

/** Screen-reader label for the whole overlay. */
export const SPLASH_STATUS_LABEL = "Sendloom is loading.";

// ---------------------------------------------------------------------------
// Particles. A fixed set is rendered (deterministic, so SSR and the first client
// render agree); the responsive/reduced-motion caps below decide how many
// actually drift, mirrored by CSS breakpoints in the stylesheet.
// ---------------------------------------------------------------------------

export const PARTICLE_TOTAL = 16;
export const MAX_PARTICLES = 18;
export const MOBILE_BREAKPOINT_PX = 640;
export const TABLET_BREAKPOINT_PX = 1024;

/**
 * How many particles should drift for a viewport. Reduced-motion returns 0 (a
 * static field); otherwise ~7 mobile / ~12 tablet / 16 desktop, always capped.
 */
export function resolveParticleCount(input: { viewportWidth: number; reducedMotion: boolean }): number {
  if (input.reducedMotion) {
    return 0;
  }
  if (!Number.isFinite(input.viewportWidth) || input.viewportWidth <= 0) {
    return 12;
  }
  if (input.viewportWidth < MOBILE_BREAKPOINT_PX) {
    return 7;
  }
  if (input.viewportWidth < TABLET_BREAKPOINT_PX) {
    return 12;
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
