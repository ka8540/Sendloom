import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BRAND_LEAD,
  BRAND_TAIL,
  EXIT_MS,
  MAX_PARTICLES,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  PARTICLE_TOTAL,
  SPLASH_STAGES,
  STAGE_THRESHOLDS_MS,
  WORKFLOW_STEPS,
  resolveParticleCount,
  resolveRemainingDelayMs,
  resolveStageIndex,
  resolveStageLabel,
  shouldDismiss
} from "@/components/startup-splash-core";
import { isLoadScreenPath, loadScreenInitScript } from "@/lib/load-screen";

// The splash + hook + gate are "use client" React modules; in the node test env
// their contract is verified through the pure logic above plus source assertions.
const SPLASH_SOURCE = readFileSync("src/components/startup-splash.tsx", "utf8");
const HOOK_SOURCE = readFileSync("src/components/use-startup-readiness.ts", "utf8");
const CORE_SOURCE = readFileSync("src/components/startup-splash-core.ts", "utf8");
const CSS_SOURCE = readFileSync("src/components/startup-splash.module.css", "utf8");
const GATE_SOURCE = readFileSync("src/components/public-load-screen.tsx", "utf8");
const LIB_SOURCE = readFileSync("src/lib/load-screen.ts", "utf8");
const LAYOUT_SOURCE = readFileSync("src/app/layout.tsx", "utf8");

function runBootScript(pathname: string): string {
  const fakeRoot = { dataset: {} as Record<string, string> };
  const fakeDocument = { documentElement: fakeRoot };
  const fakeWindow = { location: { pathname } };
  new Function("document", "window", loadScreenInitScript)(fakeDocument, fakeWindow);
  return fakeRoot.dataset.loadScreen ?? "";
}

// ---------------------------------------------------------------------------
// Cinematic composition
// ---------------------------------------------------------------------------

describe("cinematic composition", () => {
  it("(1) the new cinematic splash renders backdrop, signals, wordmark, workflow", () => {
    expect(SPLASH_SOURCE).toContain("styles.backdrop");
    expect(SPLASH_SOURCE).toContain("styles.signals");
    expect(SPLASH_SOURCE).toContain("styles.wordmark");
    expect(SPLASH_SOURCE).toContain("styles.workflow");
    expect(SPLASH_SOURCE).toContain("styles.weave");
    // A real signal system with curved paths + nodes, not four circles by a logo.
    expect(SPLASH_SOURCE).toContain("SIGNALS");
    expect(SPLASH_SOURCE).toContain("OUTBOUND");
  });

  it("(2) the rejected basic design is gone", () => {
    for (const source of [SPLASH_SOURCE, CORE_SOURCE, CSS_SOURCE]) {
      expect(source).not.toMatch(/Preparing Sendloom|Building your outreach workspace/);
    }
    // No fake counter / percentage / spinner language survives.
    for (const source of [SPLASH_SOURCE, CORE_SOURCE]) {
      expect(source).not.toMatch(/092|\bspinner\b|PRIMING THE CALM SURFACE/i);
    }
  });

  it("(3) large SENDLOOM focal typography exists (SEND solid, LOOM constructed)", () => {
    expect(BRAND_LEAD).toBe("SEND");
    expect(BRAND_TAIL).toBe("LOOM");
    expect(SPLASH_SOURCE).toContain("styles.word");
    expect(SPLASH_SOURCE).toContain("styles.lead");
    expect(SPLASH_SOURCE).toContain("styles.tail");
    // The wordmark is a strong focal point (large clamp) and LOOM is outlined.
    expect(CSS_SOURCE).toMatch(/\.word \{[\s\S]*font-size: clamp\(3rem, 12\.5vw, 9\.5rem\)/);
    expect(CSS_SOURCE).toMatch(/\.tail \{[\s\S]*-webkit-text-stroke/);
  });

  it("(4) the FIND / PERSONALIZE / SEND / TRACK workflow labels render", () => {
    expect(WORKFLOW_STEPS).toEqual(["FIND", "PERSONALIZE", "SEND", "TRACK"]);
    expect(SPLASH_SOURCE).toContain("WORKFLOW_STEPS.map");
    for (const step of WORKFLOW_STEPS) {
      expect(CSS_SOURCE).toContain(`data-step="${step.toLowerCase()}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Readiness / timing
// ---------------------------------------------------------------------------

describe("readiness & timing", () => {
  it("(7) the real page mounts beneath a fixed overlay", () => {
    expect(LAYOUT_SOURCE).toMatch(/\{children\}[\s\S]*<PublicLoadScreen \/>/);
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*position: fixed/);
  });

  it("(8) dismisses only once app-ready AND the minimum has elapsed", () => {
    expect(shouldDismiss({ elapsedMs: 1100, appReady: true })).toBe(true);
    expect(shouldDismiss({ elapsedMs: 400, appReady: true })).toBe(false);
    expect(shouldDismiss({ elapsedMs: 9999, appReady: false })).toBe(false);
  });

  it("(9) minimum visible is 800–1100ms and schedules the remainder", () => {
    expect(MIN_VISIBLE_MS).toBeGreaterThanOrEqual(800);
    expect(MIN_VISIBLE_MS).toBeLessThanOrEqual(1100);
    expect(resolveRemainingDelayMs({ elapsedMs: 200 })).toBe(MIN_VISIBLE_MS - 200);
    expect(resolveRemainingDelayMs({ elapsedMs: 5000 })).toBe(0);
    expect(HOOK_SOURCE).toMatch(/setTimeout\(dismiss, MIN_VISIBLE_MS - elapsed\(\)\)/);
  });

  it("(10) a max safety ceiling (2400–2800ms) removes a stuck splash", () => {
    expect(MAX_VISIBLE_MS).toBeGreaterThanOrEqual(2400);
    expect(MAX_VISIBLE_MS).toBeLessThanOrEqual(2800);
    expect(HOOK_SOURCE).toMatch(/setTimeout\(dismiss, MAX_VISIBLE_MS\)/);
    expect(EXIT_MS).toBeGreaterThanOrEqual(300);
    expect(EXIT_MS).toBeLessThanOrEqual(500);
  });

  it("(12) animation completion is NOT required — dismissal uses timers + wall clock", () => {
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(|["']animationend["']|["']transitionend["']/);
    expect(HOOK_SOURCE).toContain("Date.now()");
    expect(HOOK_SOURCE).toContain("setTimeout");
  });

  it("stage copy is broad, honest, and time-based (no fake precision)", () => {
    expect(SPLASH_STAGES).toEqual(["Connecting the signals", "Shaping the workflow", "Sendloom is ready"]);
    expect(resolveStageIndex(0)).toBe(0);
    expect(resolveStageIndex(STAGE_THRESHOLDS_MS[1])).toBe(1);
    expect(resolveStageIndex(99999)).toBe(SPLASH_STAGES.length - 1);
    expect(resolveStageLabel(0)).toBe("Connecting the signals");
    for (const stage of SPLASH_STAGES) {
      expect(stage).not.toMatch(/\d+%/);
    }
  });
});

// ---------------------------------------------------------------------------
// Hidden-tab behavior
// ---------------------------------------------------------------------------

describe("hidden-tab behavior", () => {
  it("(11) returning to the tab reconciles stage + readiness immediately", () => {
    expect(HOOK_SOURCE).toContain('addEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toMatch(/reconcile = \(\) => \{[\s\S]*visibilityState[\s\S]*resolveStageIndex\(elapsed\(\)\)[\s\S]*evaluate\(\)/);
  });

  it("(13) focus reconciliation is wired", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("focus", reconcile)');
  });

  it("(14) pageshow reconciliation is wired", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("pageshow", reconcile)');
  });

  it("(16) listeners and timers are cleaned up", () => {
    expect(HOOK_SOURCE).toContain('removeEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("focus", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("pageshow", reconcile)');
    expect((HOOK_SOURCE.match(/clearTimeout/g)?.length ?? 0)).toBeGreaterThanOrEqual(3);
    expect(HOOK_SOURCE).toContain("let dismissed = false");
  });

  it("(17) the overlay unmounts fully when done", () => {
    expect(SPLASH_SOURCE).toMatch(/if \(phase === "done"\) \{\s*return null;/);
  });

  it("(18) body scroll/overflow is never mutated (nothing to restore)", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, GATE_SOURCE]) {
      expect(source).not.toMatch(/document\.body|overflow\s*=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("(15) decides once on mount — no replay on client nav / theme / query", () => {
    expect(GATE_SOURCE).toContain("reconciledRef");
    expect(GATE_SOURCE).toMatch(/if \(reconciledRef\.current\) \{\s*return;/);
    expect(GATE_SOURCE).toMatch(/useIsomorphicLayoutEffect\(\(\) => \{[\s\S]*\}, \[\]\)/);
  });

  it("shows on a hard load of splash paths only, with no storage suppression", () => {
    expect(runBootScript("/")).toBe("show");
    expect(runBootScript("/login")).toBe("show");
    expect(runBootScript("/workspace")).toBe("hide");
    expect(isLoadScreenPath("/")).toBe(true);
    expect(isLoadScreenPath("/prospects")).toBe(false);
    expect(LIB_SOURCE).not.toMatch(/localStorage|sessionStorage/i);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("(5) particle count is capped", () => {
    expect(MAX_PARTICLES).toBeLessThanOrEqual(22);
    expect(PARTICLE_TOTAL).toBeLessThanOrEqual(MAX_PARTICLES);
    for (const width of [320, 640, 1024, 1440, 3840]) {
      expect(resolveParticleCount({ viewportWidth: width, reducedMotion: false })).toBeLessThanOrEqual(MAX_PARTICLES);
    }
  });

  it("(6) mobile uses fewer particles than desktop, within the spec ranges", () => {
    const mobile = resolveParticleCount({ viewportWidth: 375, reducedMotion: false });
    const tablet = resolveParticleCount({ viewportWidth: 800, reducedMotion: false });
    const desktop = resolveParticleCount({ viewportWidth: 1440, reducedMotion: false });
    expect(mobile).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(desktop);
    expect(mobile).toBeGreaterThanOrEqual(5);
    expect(mobile).toBeLessThanOrEqual(9);
    expect(desktop).toBeGreaterThanOrEqual(14);
    expect(desktop).toBeLessThanOrEqual(22);
    // CSS mirrors the caps by hiding surplus particles.
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 13\)/);
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 8\)/);
  });

  it("(22) no WebGL / video / new animation library / remote image", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, CORE_SOURCE, CSS_SOURCE]) {
      expect(source).not.toMatch(/three|WebGL|<canvas|<video|url\(https?:|gsap|framer-motion|lottie/i);
    }
    expect(SPLASH_SOURCE).not.toMatch(/next\/image|<img\b/);
    // Motion is CSS keyframes only.
    expect(CSS_SOURCE).toMatch(/@keyframes splashDraw/);
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(|setInterval\(/);
  });

  it("(23) no dashboard/backend flow is touched", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, CORE_SOURCE]) {
      expect(source).not.toMatch(/fetch\(|graphql|MUTATION|prospect|discover|dashboard|workspace/i);
    }
    expect(() => readFileSync("src/components/prospects/prospect-processing.ts", "utf8")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Accessibility & themes
// ---------------------------------------------------------------------------

describe("accessibility & themes", () => {
  it("exposes status semantics without over-announcing", () => {
    expect(SPLASH_SOURCE).toMatch(/aria-busy=\{phase === "loading"\}/);
    expect(SPLASH_SOURCE).toMatch(/role="status" aria-live="polite"/);
    // Decorative graphics are hidden from assistive tech.
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.backdrop\} aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.signals\}[\s\S]*aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.workflow\} aria-hidden="true"/);
  });

  it("(19) reduced motion keeps a full, crisp static composition", () => {
    expect(CSS_SOURCE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS_SOURCE).toMatch(/animation: none !important/);
    // The wordmark + nodes resolve to their finished state (not hidden).
    expect(CSS_SOURCE).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.lead,[\s\S]*opacity: 1/);
    expect(resolveParticleCount({ viewportWidth: 1440, reducedMotion: true })).toBe(0);
  });

  it("(20) colours are theme tokens only — dark and light both work", () => {
    expect(CSS_SOURCE).toContain("var(--accent)");
    expect(CSS_SOURCE).toContain("var(--bg-start)");
    expect(CSS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS_SOURCE).not.toMatch(/\brgb\(/);
  });

  it("(21) responsive, no horizontal overflow, safe-area aware", () => {
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*overflow: hidden/);
    expect(CSS_SOURCE).toContain("@media (max-width: 1024px)");
    expect(CSS_SOURCE).toContain("@media (max-width: 640px)");
    expect(CSS_SOURCE).toContain("env(safe-area-inset-bottom)");
  });

  it("(1-visual) removes the old giant-SEND splash entirely", () => {
    expect(() => readFileSync("src/components/load-screen.tsx", "utf8")).toThrow();
    expect(CSS_SOURCE).toContain("var(--font-loader-body)");
    expect(CSS_SOURCE).not.toMatch(/Bebas|font-loader-display/);
  });
});
