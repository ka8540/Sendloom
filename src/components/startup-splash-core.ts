// Pure, DOM-free logic for the Sendloom startup splash.
//
// The splash is a boot transition, NOT a backend job: it covers the very first
// paint of the public site, then dismisses as soon as the app is interactive and
// a brief, premium minimum has elapsed. Dismissal is driven by *readiness*, never
// by a decorative animation completing — so a throttled/hidden tab can't trap it.
//
// This module holds every timing/branching decision so it is unit-testable under
// the repo's node-only vitest setup. No React, no timers, no fetch.

export type SplashPhase =
  | "loading" // overlay visible, app initializing
  | "exiting" // readiness met — playing the short fade-out (non-blocking)
  | "done"; // removed from the DOM

// Minimum time the splash stays up so it never flashes; and the hard safety
// ceiling after which it is removed no matter what (it must never get stuck).
export const MIN_VISIBLE_MS = 500;
export const MAX_VISIBLE_MS = 2500;
// Exit fade duration. Removal is scheduled off a timer (not transitionend) so a
// hidden tab that never fires the transition still unmounts the overlay.
export const EXIT_MS = 320;

// Decorative particles. A fixed set is rendered (deterministic, so SSR and the
// first client render agree); the responsive/reduced-motion caps below decide
// how many actually drift, mirrored by CSS breakpoints in the stylesheet.
export const PARTICLE_TOTAL = 16;
export const MAX_PARTICLES = 16;
export const MOBILE_BREAKPOINT_PX = 640;
export const TABLET_BREAKPOINT_PX = 1024;

/**
 * How many particles should drift for a viewport. Reduced-motion returns 0 (a
 * static field); otherwise ~6 mobile / ~10 tablet / 16 desktop, always capped.
 */
export function resolveParticleCount(input: { viewportWidth: number; reducedMotion: boolean }): number {
  if (input.reducedMotion) {
    return 0;
  }
  if (!Number.isFinite(input.viewportWidth) || input.viewportWidth <= 0) {
    return 10;
  }
  if (input.viewportWidth < MOBILE_BREAKPOINT_PX) {
    return 6;
  }
  if (input.viewportWidth < TABLET_BREAKPOINT_PX) {
    return 10;
  }
  return MAX_PARTICLES;
}

/**
 * The readiness rule: dismiss once the app is interactive AND the brief minimum
 * has elapsed. "Ready" here is simply "React has mounted" — the real, already
 * server-rendered page is interactive by then; we do not wait on fonts, images,
 * analytics, or any network.
 */
export function shouldDismiss(input: {
  elapsedMs: number;
  appReady: boolean;
  minVisibleMs?: number;
}): boolean {
  const min = input.minVisibleMs ?? MIN_VISIBLE_MS;
  return input.appReady && input.elapsedMs >= min;
}

/** Milliseconds still to wait before the minimum-visible window is satisfied. */
export function resolveRemainingDelayMs(input: { elapsedMs: number; minVisibleMs?: number }): number {
  const min = input.minVisibleMs ?? MIN_VISIBLE_MS;
  return Math.max(0, min - input.elapsedMs);
}

// ---------------------------------------------------------------------------
// Product copy. Short, honest — no fake precision, no "priming the calm surface".
// ---------------------------------------------------------------------------

export const SPLASH_HEADLINE = "Preparing Sendloom";
export const SPLASH_SUBTEXT = "Building your outreach workspace.";
/** Screen-reader label for the whole overlay. */
export const SPLASH_STATUS_LABEL = "Sendloom is loading.";

// The four scattered signals the Signal Loom mark weaves into one outreach line.
// Decorative labels only (never announced); they anchor the concept.
export const SPLASH_SIGNALS = ["Company", "Person", "Email", "Outreach"] as const;
