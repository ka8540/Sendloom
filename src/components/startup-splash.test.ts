import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BRAND,
  BRAND_TAGLINE,
  COMMAND_MODULES,
  EXIT_MS,
  MAX_PARTICLES,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  PARTICLE_TOTAL,
  SPLASH_STAGES,
  STAGE_THRESHOLDS_MS,
  resolveParticleCount,
  resolveRemainingDelayMs,
  resolveStageIndex,
  resolveStageLabel,
  shouldDismiss
} from "@/components/startup-splash-core";
import {
  STARTUP_SPLASH_COOLDOWN_MS,
  STARTUP_SPLASH_LAST_SHOWN_KEY,
  isLoadScreenPath,
  isStartupSplashCooldownActive,
  loadScreenInitScript,
  markStartupSplashShown
} from "@/lib/load-screen";

// The splash + hook + gate are "use client" React modules; in the node test env
// their contract is verified through the pure logic above plus source assertions.
const SPLASH_SOURCE = readFileSync("src/components/startup-splash.tsx", "utf8");
const HOOK_SOURCE = readFileSync("src/components/use-startup-readiness.ts", "utf8");
const CORE_SOURCE = readFileSync("src/components/startup-splash-core.ts", "utf8");
const CSS_SOURCE = readFileSync("src/components/startup-splash.module.css", "utf8");
const GATE_SOURCE = readFileSync("src/components/public-load-screen.tsx", "utf8");
const LAYOUT_SOURCE = readFileSync("src/app/layout.tsx", "utf8");
const GLOBALS_SOURCE = readFileSync("src/app/globals.css", "utf8");

const ALL_SPLASH_SOURCES = [SPLASH_SOURCE, HOOK_SOURCE, CORE_SOURCE, CSS_SOURCE];

// Rejected copy is asserted via joined fragments so a plain-text sweep of the
// repo for the old strings cannot match this test file itself.
function bansCopy(fragments: string[]): void {
  const phrase = fragments.join("");
  for (const source of ALL_SPLASH_SOURCES) {
    expect(source.includes(phrase)).toBe(false);
  }
}

// Fake localStorage for exercising the synchronous boot script + helpers.
type FakeStorage = {
  values: Map<string, string>;
  setCalls: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function makeStorage(initial?: Record<string, string>): FakeStorage {
  const values = new Map(Object.entries(initial ?? {}));
  const storage: FakeStorage = {
    values,
    setCalls: 0,
    getItem: (key) => (values.has(key) ? (values.get(key) as string) : null),
    setItem: (key, value) => {
      storage.setCalls += 1;
      values.set(key, value);
    }
  };
  return storage;
}

function runBootScript(pathname: string, storage?: unknown): string {
  const fakeRoot = { dataset: {} as Record<string, string> };
  const fakeDocument = { documentElement: fakeRoot };
  const fakeWindow: Record<string, unknown> = { location: { pathname } };
  if (storage !== undefined) {
    fakeWindow.localStorage = storage;
  }
  new Function("document", "window", loadScreenInitScript)(fakeDocument, fakeWindow);
  return fakeRoot.dataset.loadScreen ?? "";
}

// ---------------------------------------------------------------------------
// Command-center composition
// ---------------------------------------------------------------------------

describe("command-center composition", () => {
  it("(1) renders on a hard initial load of splash paths only", () => {
    // No localStorage on the fake window = storage-unavailable fallback: show.
    expect(runBootScript("/")).toBe("show");
    expect(runBootScript("/login")).toBe("show");
    expect(runBootScript("/workspace")).toBe("hide");
    expect(isLoadScreenPath("/")).toBe(true);
    expect(isLoadScreenPath("/prospects")).toBe(false);
    // The overlay is part of the initial HTML (state derived from the pathname).
    expect(GATE_SOURCE).toMatch(/useState\(\(\) => isLoadScreenPath\(pathname\)\)/);
    expect(SPLASH_SOURCE).toContain("data-loader-overlay");
  });

  it("(2) the real page mounts beneath a fixed overlay", () => {
    expect(LAYOUT_SOURCE).toMatch(/\{children\}[\s\S]*<PublicLoadScreen \/>/);
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*position: fixed/);
  });

  it("(3) the full SENDLOOM brand lockup renders with the new title treatment", () => {
    expect(BRAND).toBe("SENDLOOM");
    expect(BRAND_TAGLINE.toUpperCase()).toBe("OUTREACH OPERATIONS");
    expect(SPLASH_SOURCE).toContain("{BRAND}");
    expect(SPLASH_SOURCE).toContain("{BRAND_TAGLINE}");
    expect(SPLASH_SOURCE).toContain("SendloomLogo");
    expect(SPLASH_SOURCE).toContain("styles.markText");
    expect(SPLASH_SOURCE).toContain("styles.markScan");
    // Sharp wide-tracked command title + emerald scan — not the old split/outline.
    expect(CSS_SOURCE).toMatch(/\.markText \{[\s\S]*letter-spacing: 0\.14em/);
    expect(CSS_SOURCE).toMatch(/@keyframes splashScan/);
    expect(CSS_SOURCE).not.toContain("-webkit-text-stroke");
  });

  it("(4) the command map + mobile module flow both render the workflow system", () => {
    expect(SPLASH_SOURCE).toContain("function CommandMap");
    expect(SPLASH_SOURCE).toContain("function ModuleFlow");
    expect(SPLASH_SOURCE).toContain("styles.commandMap");
    expect(SPLASH_SOURCE).toContain("styles.moduleFlow");
    expect(SPLASH_SOURCE).toContain("styles.sendRail");
    expect(SPLASH_SOURCE).toContain("styles.core");
    // Panels dock around a central core with routing spokes — real graphics,
    // not floating text chips.
    expect(SPLASH_SOURCE).toContain("PANELS");
    expect(SPLASH_SOURCE).toMatch(/spoke: "M/);
    expect(SPLASH_SOURCE).toContain("function ModuleGlyph");
  });

  it("(5) product modules cover Import, Enrich, Template, Sequence, Send, Track", () => {
    expect(COMMAND_MODULES.map((module) => module.key)).toEqual([
      "import",
      "enrich",
      "template",
      "sequence",
      "send",
      "track"
    ]);
    expect(SPLASH_SOURCE).toContain("COMMAND_MODULES.map");
    // Each module has its own meaningful glyph, not just a label.
    for (const module of COMMAND_MODULES) {
      expect(SPLASH_SOURCE).toContain(`case "${module.key}"`);
      expect(module.detail.length).toBeGreaterThan(0);
    }
  });

  it("(6) the old LOAD splash is gone", () => {
    expect(() => readFileSync("src/components/load-screen.tsx", "utf8")).toThrow();
    for (const source of ALL_SPLASH_SOURCES) {
      expect(source).not.toMatch(/\bLOAD\b/);
    }
    bansCopy(["Loading ", "Send loom"]);
    bansCopy(["Reading ", "audience, sender, and sequence state"]);
  });

  it("(7) the rejected basic-splash copy is gone", () => {
    bansCopy(["Preparing ", "Sendloom"]);
    bansCopy(["Building your ", "outreach workspace"]);
  });

  it("(8) the rejected woven-signals visual treatment is gone", () => {
    bansCopy(["Outreach ", "Loom"]);
    bansCopy(["Organizing the ", "outreach flow"]);
    bansCopy(["Connecting leads, messages, ", "and sends"]);
    bansCopy(["Ready for ", "controlled outreach"]);
    // Old composition identifiers must not survive the redesign.
    for (const identifier of ["SIGNALS", "OUTBOUND", "KNOT", "WORKFLOW_STEPS", "BRAND_LEAD", "BRAND_TAIL"]) {
      expect(SPLASH_SOURCE).not.toContain(identifier);
      expect(CORE_SOURCE).not.toContain(identifier);
    }
    for (const className of [".weave", ".workflow", ".wordmark", ".signals", ".lead", ".tail"]) {
      expect(CSS_SOURCE).not.toContain(`${className} {`);
    }
    expect(SPLASH_SOURCE).not.toContain("styles.weave");
    expect(SPLASH_SOURCE).not.toContain("styles.workflow");
  });

  it("(9) no fake numeric counter exists or is required for dismissal", () => {
    for (const stage of SPLASH_STAGES) {
      expect(stage).not.toMatch(/\d/);
    }
    bansCopy(["0", "92"]);
    bansCopy(["01", "8"]);
    expect(HOOK_SOURCE).not.toMatch(/percent|progressValue|counter/i);
    // Dismissal is pure readiness + wall clock.
    expect(shouldDismiss({ elapsedMs: MIN_VISIBLE_MS, appReady: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Readiness / timing
// ---------------------------------------------------------------------------

describe("readiness & timing", () => {
  it("(10) minimum visible time is 650-850ms and the remainder is scheduled", () => {
    expect(MIN_VISIBLE_MS).toBeGreaterThanOrEqual(650);
    expect(MIN_VISIBLE_MS).toBeLessThanOrEqual(850);
    expect(shouldDismiss({ elapsedMs: MIN_VISIBLE_MS - 1, appReady: true })).toBe(false);
    expect(shouldDismiss({ elapsedMs: 9999, appReady: false })).toBe(false);
    expect(resolveRemainingDelayMs({ elapsedMs: 200 })).toBe(MIN_VISIBLE_MS - 200);
    expect(resolveRemainingDelayMs({ elapsedMs: 5000 })).toBe(0);
    expect(HOOK_SOURCE).toMatch(/setTimeout\(dismiss, MIN_VISIBLE_MS - elapsed\(\)\)/);
  });

  it("(11) a hard 2200ms ceiling releases the page no matter what", () => {
    expect(MAX_VISIBLE_MS).toBeLessThanOrEqual(2200);
    expect(MAX_VISIBLE_MS).toBeGreaterThan(MIN_VISIBLE_MS);
    expect(HOOK_SOURCE).toMatch(/setTimeout\(dismiss, MAX_VISIBLE_MS\)/);
    expect(EXIT_MS).toBeGreaterThanOrEqual(250);
    expect(EXIT_MS).toBeLessThanOrEqual(400);
  });

  it("(12) animation completion is NOT required — dismissal uses timers + wall clock", () => {
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(|["']animationend["']|["']transitionend["']/);
    expect(SPLASH_SOURCE).not.toMatch(/onAnimationEnd|onTransitionEnd/);
    expect(HOOK_SOURCE).toContain("Date.now()");
    expect(HOOK_SOURCE).toContain("setTimeout");
  });

  it("stage copy is broad, honest, and advances on wall-clock thresholds", () => {
    expect(SPLASH_STAGES).toEqual([
      "Assembling your outreach engine",
      "Connecting leads, messages, and send controls",
      "Opening the command center"
    ]);
    expect(resolveStageIndex(0)).toBe(0);
    expect(resolveStageIndex(STAGE_THRESHOLDS_MS[1])).toBe(1);
    expect(resolveStageIndex(99999)).toBe(SPLASH_STAGES.length - 1);
    expect(resolveStageLabel(0)).toBe("Assembling your outreach engine");
    // The boot progress treatment is stage-driven, not a percentage bar.
    expect(SPLASH_SOURCE).toContain("data-stage={stage}");
    expect(CSS_SOURCE).toContain('[data-stage="2"]');
    expect(CSS_SOURCE).toContain("--splash-seg");
  });
});

// ---------------------------------------------------------------------------
// 30-minute cooldown
// ---------------------------------------------------------------------------

describe("30-minute cooldown", () => {
  const NOW = Date.now();
  const FRESH = { [STARTUP_SPLASH_LAST_SHOWN_KEY]: String(NOW - 5 * 60 * 1000) };
  const EXPIRED = { [STARTUP_SPLASH_LAST_SHOWN_KEY]: String(NOW - STARTUP_SPLASH_COOLDOWN_MS - 1000) };

  it("(c1) shows when no timestamp exists", () => {
    expect(STARTUP_SPLASH_COOLDOWN_MS).toBe(30 * 60 * 1000);
    expect(runBootScript("/", makeStorage())).toBe("show");
  });

  it("(c2) stamps last-shown-at exactly once when the splash is displayed", () => {
    const storage = makeStorage();
    const before = Date.now();
    expect(runBootScript("/", storage)).toBe("show");
    const after = Date.now();
    expect(storage.setCalls).toBe(1);
    const written = Number(storage.values.get(STARTUP_SPLASH_LAST_SHOWN_KEY));
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(after);
  });

  it("(c3) skips while the stamp is fresh — and a skip never refreshes the stamp", () => {
    const storage = makeStorage(FRESH);
    expect(runBootScript("/", storage)).toBe("hide");
    expect(storage.setCalls).toBe(0);
    expect(storage.values.get(STARTUP_SPLASH_LAST_SHOWN_KEY)).toBe(FRESH[STARTUP_SPLASH_LAST_SHOWN_KEY]);
  });

  it("(c4) shows again after the stamp expires, refreshing it", () => {
    const storage = makeStorage(EXPIRED);
    expect(runBootScript("/", storage)).toBe("show");
    expect(storage.setCalls).toBe(1);
    expect(Number(storage.values.get(STARTUP_SPLASH_LAST_SHOWN_KEY))).toBeGreaterThan(
      Number(EXPIRED[STARTUP_SPLASH_LAST_SHOWN_KEY])
    );
  });

  it("(c5) invalid or future timestamps are ignored safely", () => {
    for (const bad of ["garbage", "", String(NOW + 60 * 1000)]) {
      expect(runBootScript("/", makeStorage({ [STARTUP_SPLASH_LAST_SHOWN_KEY]: bad }))).toBe("show");
    }
  });

  it("(c6) unavailable or throwing storage never crashes and falls back to showing", () => {
    expect(runBootScript("/")).toBe("show");
    expect(runBootScript("/", null)).toBe("show");
    const throwingRead = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {}
    };
    expect(runBootScript("/", throwingRead)).toBe("show");
    const throwingWrite = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      }
    };
    expect(runBootScript("/", throwingWrite)).toBe("show");
  });

  it("(c7) the cooldown applies on /, /login, and /signup", () => {
    for (const path of ["/", "/login", "/signup"]) {
      expect(runBootScript(path, makeStorage(FRESH))).toBe("hide");
      expect(runBootScript(path, makeStorage())).toBe("show");
    }
  });

  it("(c8) app/dashboard routes never show the splash and never write the stamp", () => {
    for (const path of ["/workspace", "/campaigns", "/prospects", "/imports", "/templates", "/admin"]) {
      const storage = makeStorage();
      expect(runBootScript(path, storage)).toBe("hide");
      expect(storage.setCalls).toBe(0);
      expect(storage.values.size).toBe(0);
    }
  });

  it("(c9) the TS helpers agree with the boot script and are failure-safe", () => {
    expect(isStartupSplashCooldownActive(NOW, makeStorage(FRESH))).toBe(true);
    expect(isStartupSplashCooldownActive(NOW, makeStorage(EXPIRED))).toBe(false);
    expect(isStartupSplashCooldownActive(NOW, makeStorage())).toBe(false);
    expect(isStartupSplashCooldownActive(NOW, makeStorage({ [STARTUP_SPLASH_LAST_SHOWN_KEY]: "junk" }))).toBe(false);
    expect(isStartupSplashCooldownActive(NOW, null)).toBe(false);
    expect(
      isStartupSplashCooldownActive(NOW, {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {}
      })
    ).toBe(false);
    // In this node env there is no window at all — the default must be safe.
    expect(isStartupSplashCooldownActive()).toBe(false);
    expect(() => markStartupSplashShown()).not.toThrow();

    const storage = makeStorage();
    markStartupSplashShown(NOW, storage);
    expect(storage.values.get(STARTUP_SPLASH_LAST_SHOWN_KEY)).toBe(String(NOW));
    expect(isStartupSplashCooldownActive(NOW + 1, storage)).toBe(true);
    expect(isStartupSplashCooldownActive(NOW + STARTUP_SPLASH_COOLDOWN_MS, storage)).toBe(false);
    expect(() =>
      markStartupSplashShown(NOW, {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        }
      })
    ).not.toThrow();
  });

  it("(c10) a skip is flash-free: decided synchronously pre-paint, overlay never rendered", () => {
    // The decision runs as a parser-blocking inline script in the root layout…
    expect(LAYOUT_SOURCE).toContain("dangerouslySetInnerHTML={{ __html: loadScreenInitScript }}");
    // …with nothing asynchronous in the decision path…
    expect(loadScreenInitScript).not.toMatch(/setTimeout|await|\.then\(|requestAnimationFrame/);
    // …and CSS suppresses the server-rendered overlay before hydration…
    expect(GLOBALS_SOURCE).toMatch(
      /html:not\(\[data-load-screen="show"\]\) \[data-loader-overlay\] \{\s*display: none !important;/
    );
    // …then the gate unmounts it before the splash's own effects (timers,
    // listeners, stage advance) could ever start: layout effect runs pre-paint.
    expect(GATE_SOURCE).toContain("useIsomorphicLayoutEffect");
    expect(GATE_SOURCE).toMatch(/dataset\.loadScreen === "show"/);
    expect(GATE_SOURCE).toMatch(/if \(!showSplash\) \{\s*return null;/);
    // Particles + every animated layer live inside that unmounted overlay.
    expect(SPLASH_SOURCE).toMatch(/data-loader-overlay=""[\s\S]*styles\.particles/);
  });

  it("(c11) cross-tab: a stamp written by another tab dismisses a visible splash early", () => {
    expect(HOOK_SOURCE).toContain("STARTUP_SPLASH_LAST_SHOWN_KEY");
    expect(HOOK_SOURCE).toMatch(/event\.key === STARTUP_SPLASH_LAST_SHOWN_KEY && event\.newValue !== null/);
    expect(HOOK_SOURCE).toContain('window.addEventListener("storage", onStorage)');
    expect(HOOK_SOURCE).toContain('window.removeEventListener("storage", onStorage)');
  });
});

// ---------------------------------------------------------------------------
// Hidden-tab behavior
// ---------------------------------------------------------------------------

describe("hidden-tab behavior", () => {
  it("(13) a hidden tab never resets or replays the splash", () => {
    expect(HOOK_SOURCE).toContain("let dismissed = false");
    expect(GATE_SOURCE).toContain("reconciledRef");
    expect(GATE_SOURCE).toMatch(/if \(reconciledRef\.current\) \{\s*return;/);
    // Stage is recomputed from elapsed wall-clock time — never rewound.
    expect(HOOK_SOURCE).toMatch(/resolveStageIndex\(elapsed\(\)\)/);
  });

  it("(14) returning from a hidden tab reconciles readiness and can dismiss immediately", () => {
    expect(HOOK_SOURCE).toContain('addEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toMatch(/reconcile = \(\) => \{[\s\S]*visibilityState[\s\S]*evaluate\(\)/);
    expect(HOOK_SOURCE).toMatch(/if \(elapsed\(\) >= MIN_VISIBLE_MS\) \{\s*dismiss\(\);/);
  });

  it("(15) focus and pageshow reconciliation are wired", () => {
    expect(HOOK_SOURCE).toContain('window.addEventListener("focus", reconcile)');
    expect(HOOK_SOURCE).toContain('window.addEventListener("pageshow", reconcile)');
  });

  it("(16) the overlay unmounts fully when done", () => {
    expect(SPLASH_SOURCE).toMatch(/if \(phase === "done"\) \{\s*return null;/);
  });

  it("(17) timers and listeners are cleaned up", () => {
    expect(HOOK_SOURCE).toContain('removeEventListener("visibilitychange", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("focus", reconcile)');
    expect(HOOK_SOURCE).toContain('removeEventListener("pageshow", reconcile)');
    expect((HOOK_SOURCE.match(/clearTimeout/g)?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it("(18) body scroll is never mutated (nothing to restore)", () => {
    for (const source of [SPLASH_SOURCE, HOOK_SOURCE, GATE_SOURCE]) {
      expect(source).not.toMatch(/document\.body|overflow\s*=/);
    }
  });

  it("decides once on mount — no replay on client nav / theme / query", () => {
    expect(GATE_SOURCE).toMatch(/useIsomorphicLayoutEffect\(\(\) => \{[\s\S]*\}, \[\]\)/);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("(20) particle counts are sparse and reduced per breakpoint", () => {
    expect(MAX_PARTICLES).toBeLessThanOrEqual(16);
    expect(PARTICLE_TOTAL).toBeLessThanOrEqual(MAX_PARTICLES);
    const mobile = resolveParticleCount({ viewportWidth: 375, reducedMotion: false });
    const tablet = resolveParticleCount({ viewportWidth: 800, reducedMotion: false });
    const desktop = resolveParticleCount({ viewportWidth: 1440, reducedMotion: false });
    expect(mobile).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(desktop);
    expect(mobile).toBeLessThanOrEqual(6);
    expect(desktop).toBeLessThanOrEqual(MAX_PARTICLES);
    for (const width of [320, 640, 1024, 1440, 3840]) {
      expect(resolveParticleCount({ viewportWidth: width, reducedMotion: false })).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    // CSS mirrors the caps by hiding surplus particles.
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 9\)/);
    expect(CSS_SOURCE).toMatch(/nth-child\(n \+ 6\)/);
  });

  it("(21) no WebGL / canvas loop / video / new animation library / remote assets", () => {
    for (const source of ALL_SPLASH_SOURCES) {
      expect(source).not.toMatch(/three|WebGL|<canvas|<video|url\(https?:|gsap|framer-motion|lottie/i);
    }
    expect(SPLASH_SOURCE).not.toMatch(/next\/image|<img\b/);
    // Motion is CSS keyframes only; no JS animation loop.
    expect(CSS_SOURCE).toMatch(/@keyframes splashDraw/);
    expect(HOOK_SOURCE).not.toMatch(/requestAnimationFrame\(|setInterval\(/);
    expect(SPLASH_SOURCE).not.toMatch(/requestAnimationFrame\(|setInterval\(/);
  });

  it("(22) no dashboard/Discover/sequence-processing loader is touched", () => {
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
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.backdrop\} aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.mapZone\} aria-hidden="true"/);
    expect(SPLASH_SOURCE).toMatch(/className=\{styles\.moduleFlow\} aria-hidden="true"/);
  });

  it("(19) reduced motion keeps the full, resolved command-center composition", () => {
    expect(CSS_SOURCE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS_SOURCE).toMatch(/animation: none !important/);
    // Panels, core, brand, and footer resolve to their finished state.
    expect(CSS_SOURCE).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.panel,[\s\S]*opacity: 1;\s*transform: none/);
    // Travelling pulses are removed rather than frozen mid-path.
    expect(CSS_SOURCE).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.railPulses,[\s\S]*display: none/);
    expect(resolveParticleCount({ viewportWidth: 1440, reducedMotion: true })).toBe(0);
  });

  it("colours are theme tokens only — dark and light both work, no theme flash", () => {
    expect(CSS_SOURCE).toContain("var(--accent)");
    expect(CSS_SOURCE).toContain("var(--bg-start)");
    expect(CSS_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS_SOURCE).not.toMatch(/\brgb\(/);
  });

  it("responsive: asymmetric desktop, stacked tablet, separate mobile flow", () => {
    expect(CSS_SOURCE).toMatch(/\.overlay \{[\s\S]*overflow: hidden/);
    expect(CSS_SOURCE).toMatch(/\.scene \{[\s\S]*grid-template-columns: minmax\(0, 45%\) minmax\(0, 55%\)/);
    expect(CSS_SOURCE).toContain("@media (max-width: 1024px)");
    expect(CSS_SOURCE).toContain("@media (max-width: 900px)");
    expect(CSS_SOURCE).toContain("@media (max-width: 640px)");
    expect(CSS_SOURCE).toContain("env(safe-area-inset-bottom)");
    expect(CSS_SOURCE).toContain("env(safe-area-inset-top");
    expect(CSS_SOURCE).toContain("var(--font-loader-body)");
  });
});
