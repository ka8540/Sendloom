import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EXIT_MS,
  MAX_PARTICLES,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  PARTICLE_TOTAL,
  SPLASH_HEADLINE,
  SPLASH_SUBTEXT,
  resolveParticleCount,
  resolveRemainingDelayMs,
  shouldDismiss
} from "@/components/startup-splash-core";
import { isLoadScreenPath, loadScreenInitScript } from "@/lib/load-screen";

// The splash + hook + gate are "use client" React modules; in the node test env
// their contract is verified through the pure logic above plus source assertions
// — the same style the rest of the suite uses for client components.
const SPLASH_SOURCE = readFileSync("src/components/startup-splash.tsx", "utf8");
const HOOK_SOURCE = readFileSync("src/components/use-startup-readiness.ts", "utf8");
const CORE_SOURCE = readFileSync("src/components/startup-splash-core.ts", "utf8");
const CSS_SOURCE = readFileSync("src/components/startup-splash.module.css", "utf8");
const GATE_SOURCE = readFileSync("src/components/public-load-screen.tsx", "utf8");
const LIB_SOURCE = readFileSync("src/lib/load-screen.ts", "utf8");
const LAYOUT_SOURCE = readFileSync("src/app/layout.tsx", "utf8");

// Evaluate the synchronous boot script against a fake document/window to prove
// the per-load show/hide decision.
function runBootScript(pathname: string): string {
  let decided = "";
  const fakeRoot = { dataset: {} as Record<string, string> };
  const fakeDocument = { documentElement: fakeRoot };
  const fakeWindow = { location: { pathname } };
  new Function("document", "window", loadScreenInitScript)(fakeDocument, fakeWindow);
  decided = fakeRoot.dataset.loadScreen ?? "";
  return decided;
}

// ---------------------------------------------------------------------------
// Correct target
// ---------------------------------------------------------------------------

describe("correct target — the global startup splash", () => {
  it("(1) mounts on a hard initial visit to a splash path", () => {
    expect(runBootScript("/")).toBe("show");
    expect(runBootScript("/login")).toBe("show");
    expect(runBootScript("/signup")).toBe("show");
    expect(LAYOUT_SOURCE).toContain("<PublicLoadScreen />");
    expect(LAYOUT_SOURCE).toContain("loadScreenInitScript");
    expect(GATE_SOURCE).toContain("<StartupSplash />");
  });

  it("(2/48) is a boot transition, not a backend job — no fetch/poll/job status", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, CORE_SOURCE]) {
      expect(source).not.toMatch(/fetch\(|graphql|MUTATION|prospectSearch|jobId|setInterval\(/i);
    }
  });

  it("(3/46/47) does not touch dashboard/Discover/prospects", () => {
    expect(SPLASH_SOURCE).not.toMatch(/prospect|discover|dashboard|workspace/i);
    // The reverted incorrect implementation is gone.
    expect(() => readFileSync("src/components/prospects/prospect-processing.ts", "utf8")).toThrow();
  });

  it("(4) introduces no job polling", () => {
    expect(HOOK_SOURCE).not.toMatch(/setInterval/);
  });
});

// ---------------------------------------------------------------------------
// Readiness / dismissal
// ---------------------------------------------------------------------------

describe("readiness & dismissal", () => {
  it("(5) the real page renders alongside the overlay (overlay is a fixed sibling)", () => {
    // Layout renders {children} and the splash as siblings; the splash is a fixed
    // overlay, so the real page is never gated behind it.
    expect(LAYOUT_SOURCE).toMatch(/\{children\}[\s\S]*<PublicLoadScreen \/>/);
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*position: fixed/);
  });

  it("(6) dismisses only once app-ready AND the minimum has elapsed", () => {
    expect(shouldDismiss({ elapsedMs: 600, appReady: true })).toBe(true);
    expect(shouldDismiss({ elapsedMs: 200, appReady: true })).toBe(false);
    expect(shouldDismiss({ elapsedMs: 9999, appReady: false })).toBe(false);
  });

  it("(7) never waits for animation completion — dismissal uses timers, not rAF", () => {
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(|["']transitionend["']|["']animationend["']/);
    expect(HOOK_SOURCE).toContain("setTimeout");
  });

  it("(8) a max safety ceiling removes a stuck splash", () => {
    expect(MAX_VISIBLE_MS).toBeGreaterThanOrEqual(2000);
    expect(MAX_VISIBLE_MS).toBeLessThanOrEqual(3000);
    expect(HOOK_SOURCE).toMatch(/setTimeout\(dismiss, MAX_VISIBLE_MS\)/);
  });

  it("(9) does not wait for below-the-fold assets, fonts, or network", () => {
    expect(HOOK_SOURCE).not.toMatch(/document\.fonts|new Image|addEventListener\("load"|onload/);
  });

  it("(10) dismissal happens exactly once", () => {
    expect(HOOK_SOURCE).toContain("let dismissed = false");
    expect(HOOK_SOURCE).toMatch(/if \(dismissed\) \{\s*return;/);
  });

  it("minimum is brief (350–700ms) and remaining-delay math is correct", () => {
    expect(MIN_VISIBLE_MS).toBeGreaterThanOrEqual(350);
    expect(MIN_VISIBLE_MS).toBeLessThanOrEqual(700);
    expect(resolveRemainingDelayMs({ elapsedMs: 100 })).toBe(MIN_VISIBLE_MS - 100);
    expect(resolveRemainingDelayMs({ elapsedMs: 9999 })).toBe(0);
    expect(EXIT_MS).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// Hidden-tab behavior
// ---------------------------------------------------------------------------

describe("hidden-tab behavior", () => {
  it("(11) does not reset — the effect runs once and reconcile only dismisses", () => {
    expect(HOOK_SOURCE).toMatch(/\}, \[\]\);/); // single mount effect, empty deps
    expect(HOOK_SOURCE).not.toMatch(/setPhase\("loading"\)/); // never re-enters loading
  });

  it("(12) decorative animation is CSS keyframes (browser throttles when hidden)", () => {
    expect(CSS_SOURCE).toMatch(/@keyframes splashDrift/);
    expect(CSS_SOURCE).toMatch(/@keyframes splashIndeterminate/);
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(/);
  });

  it("(13/14) returning to the tab reconciles and dismisses if ready", () => {
    expect(HOOK_SOURCE).toContain('addEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toMatch(/reconcile = \(\) => \{[\s\S]*visibilityState === "visible"[\s\S]*evaluate\(\)/);
  });

  it("(15) window focus reconciliation is wired", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("focus", reconcile)');
  });

  it("(16) pageshow reconciliation is wired", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("pageshow", reconcile)');
  });

  it("(17) no duplicate timers/listeners — cleanup clears everything", () => {
    expect(HOOK_SOURCE).toContain('removeEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("focus", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("pageshow", reconcile)');
    expect(HOOK_SOURCE.match(/clearTimeout/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Navigation behavior
// ---------------------------------------------------------------------------

describe("navigation behavior", () => {
  it("(18/19/20) decides once on mount — no replay on client nav / theme / query", () => {
    expect(GATE_SOURCE).toContain("reconciledRef");
    expect(GATE_SOURCE).toMatch(/if \(reconciledRef\.current\) \{\s*return;/);
    // The reconcile effect has empty deps — it does not re-run on pathname change.
    expect(GATE_SOURCE).toMatch(/useIsomorphicLayoutEffect\(\(\) => \{[\s\S]*\}, \[\]\)/);
  });

  it("(21) hard refresh follows the documented per-load decision", () => {
    expect(runBootScript("/")).toBe("show");
    expect(runBootScript("/workspace")).toBe("hide");
    expect(runBootScript("/prospects")).toBe("hide");
    expect(isLoadScreenPath("/")).toBe(true);
    expect(isLoadScreenPath("/workspace")).toBe(false);
    // No storage suppression — a plain per-load decision.
    expect(LIB_SOURCE).not.toMatch(/localStorage|sessionStorage/i);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("(22) particle count is capped", () => {
    expect(MAX_PARTICLES).toBeLessThanOrEqual(16);
    expect(PARTICLE_TOTAL).toBeLessThanOrEqual(16);
    for (const width of [320, 640, 1024, 1440, 3840]) {
      expect(resolveParticleCount({ viewportWidth: width, reducedMotion: false })).toBeLessThanOrEqual(MAX_PARTICLES);
    }
  });

  it("(23) mobile uses fewer particles than desktop", () => {
    const mobile = resolveParticleCount({ viewportWidth: 375, reducedMotion: false });
    const tablet = resolveParticleCount({ viewportWidth: 800, reducedMotion: false });
    const desktop = resolveParticleCount({ viewportWidth: 1440, reducedMotion: false });
    expect(mobile).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(desktop);
    expect(mobile).toBeGreaterThanOrEqual(4);
    expect(mobile).toBeLessThanOrEqual(8);
    // CSS mirrors the caps by hiding surplus particles.
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 11\)/);
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 7\)/);
  });

  it("(24/25/26/27) no WebGL / video / remote image / new animation library", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, CORE_SOURCE, CSS_SOURCE]) {
      expect(source).not.toMatch(/three|WebGL|<canvas|<video|url\(https?:|gsap|framer-motion|lottie/i);
    }
    expect(SPLASH_SOURCE).not.toMatch(/next\/image|<img\b/);
  });

  it("(28) animation stops after unmount — done phase renders nothing", () => {
    expect(SPLASH_SOURCE).toMatch(/if \(phase === "done"\) \{\s*return null;/);
  });

  it("(29) event listeners are cleaned up", () => {
    expect((HOOK_SOURCE.match(/removeEventListener/g)?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it("(30) body scroll/overflow is never mutated (nothing to restore)", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, GATE_SOURCE]) {
      expect(source).not.toMatch(/document\.body|overflow\s*=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("(31) the overlay exposes status semantics", () => {
    expect(SPLASH_SOURCE).toMatch(/role="status"/);
    expect(SPLASH_SOURCE).toMatch(/aria-live="polite"/);
    expect(SPLASH_SOURCE).toMatch(/aria-busy=\{phase === "loading"\}/);
    expect(SPLASH_SOURCE).toContain("SPLASH_STATUS_LABEL");
  });

  it("(32) decorative visuals are hidden from assistive tech", () => {
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.backdrop\} aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.mark\}[\s\S]*aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.progress\} aria-hidden="true"/);
  });

  it("(33) reduced motion is calm and static", () => {
    expect(CSS_SOURCE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS_SOURCE).toMatch(/animation: none !important/);
    expect(resolveParticleCount({ viewportWidth: 1440, reducedMotion: true })).toBe(0);
  });

  it("(34) does not trap focus", () => {
    expect(SPLASH_SOURCE).not.toMatch(/\.focus\(\)|tabIndex|keydown/);
    expect(HOOK_SOURCE).not.toMatch(/\.focus\(\)|keydown/);
  });

  it("(35/36/37) colours are theme tokens only — works in dark and light", () => {
    expect(CSS_SOURCE).toContain("var(--accent)");
    expect(CSS_SOURCE).toContain("var(--bg-start)");
    expect(CSS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS_SOURCE).not.toMatch(/\brgb\(/);
  });
});

// ---------------------------------------------------------------------------
// Themes & layout
// ---------------------------------------------------------------------------

describe("themes & layout", () => {
  it("(38) theme is resolved before the splash to avoid a flash", () => {
    // themeInitScript runs synchronously before PublicLoadScreen renders.
    expect(LAYOUT_SOURCE).toMatch(/themeInitScript[\s\S]*loadScreenInitScript[\s\S]*<PublicLoadScreen \/>/);
  });

  it("(39/40/41/42) responsive composition without horizontal overflow", () => {
    expect(CSS_SOURCE).toContain("@media (max-width: 1023px)");
    expect(CSS_SOURCE).toContain("@media (max-width: 640px)");
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*overflow: hidden/);
    expect(CSS_SOURCE).toContain("env(safe-area-inset-bottom)");
  });

  it("uses the existing production font stack (no new/giant font, no Bebas)", () => {
    expect(CSS_SOURCE).toContain("var(--font-loader-body)");
    expect(CSS_SOURCE).not.toMatch(/Bebas|font-loader-display/);
    expect(SPLASH_HEADLINE).toBe("Preparing Sendloom");
    expect(SPLASH_SUBTEXT).toMatch(/outreach/i);
  });
});

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------

describe("regression", () => {
  it("(43) the overlay stops intercepting clicks while exiting and is removed when done", () => {
    expect(CSS_SOURCE).toMatch(/data-phase="exiting"\]\s*\{[\s\S]*pointer-events: none/);
    expect(SPLASH_SOURCE).toMatch(/return null/);
  });

  it("(44) the landing 3D scene is untouched and still uses three", () => {
    const landing = readFileSync("src/components/landing-scene.tsx", "utf8");
    expect(landing).toContain('from "three"');
  });

  it("removes the old giant-SEND splash entirely", () => {
    expect(() => readFileSync("src/components/load-screen.tsx", "utf8")).toThrow();
    expect(() => readFileSync("src/components/load-screen.module.css", "utf8")).toThrow();
    // None of the old fake copy/counter survives anywhere in the splash.
    for (const source of [SPLASH_SOURCE, CORE_SOURCE, CSS_SOURCE]) {
      expect(source).not.toMatch(/PRIMING THE CALM SURFACE|LOADING SENDLOOM|092|SEND\b/);
    }
  });
});
