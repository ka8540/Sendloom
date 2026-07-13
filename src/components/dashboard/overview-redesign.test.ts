import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Source-level assertions for the Overview command-center redesign, following
// the repo's node-only source-assertion convention (no DOM in the test env).
// Covers: rendering wiring, the interactive Analytics Pulse, the route-level
// loading skeleton, empty states, accessibility, reduced motion, and the
// no-hardcoded-numbers / no-unrelated-routes guarantees.

const CENTER = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const CENTER_CSS = readFileSync("src/components/dashboard/overview-command-center.module.css", "utf8");
const PULSE = readFileSync("src/components/dashboard/analytics-pulse.tsx", "utf8");
const PULSE_CSS = readFileSync("src/components/dashboard/analytics-pulse.module.css", "utf8");
const LOADING = readFileSync("src/components/dashboard/overview-loading.tsx", "utf8");
const LOADING_CSS = readFileSync("src/components/dashboard/overview-loading.module.css", "utf8");
const WORKSPACE_PAGE = readFileSync("src/app/(app)/workspace/page.tsx", "utf8");
const WORKSPACE_LOADING = readFileSync("src/app/(app)/workspace/loading.tsx", "utf8");

describe("Overview dashboard renders (#1)", () => {
  it("the /workspace route renders the redesigned command center", () => {
    expect(WORKSPACE_PAGE).toContain('export { default } from "@/components/dashboard/overview-command-center"');
    expect(CENTER).toContain("styles.heroTitle}>Overview</h1>");
    expect(CENTER).toContain('data-overview-tour="page-intro"');
  });

  it("mounts the interactive Analytics Pulse with the hero insights", () => {
    expect(CENTER).toContain("<AnalyticsPulse");
    expect(CENTER).toContain('data-overview-tour="workspace-health"');
  });
});

describe("Loading skeleton (#2, #3)", () => {
  it("the workspace route has a dedicated loading state", () => {
    expect(WORKSPACE_LOADING).toContain('export { default } from "@/components/dashboard/overview-loading"');
  });

  it("announces loading accessibly without a text-only or spinner-only state", () => {
    expect(LOADING).toContain('role="status"');
    expect(LOADING).toContain('aria-busy="true"');
    expect(LOADING).toContain("srOnly");
    // No generic spinner: nothing spins, and the shimmer is a background sweep.
    expect(LOADING).not.toMatch(/spinner|Loader2|dashboard-spin/);
    expect(LOADING_CSS).not.toMatch(/rotate\(360deg\)|animation:[^;]*spin/);
  });

  it("mirrors the real dashboard layout: hero, command card, metric cards, chart placeholders", () => {
    for (const piece of ["heroContent", "actionCard", "ctaRow", "donutRing", "healthCells", "summaryRow", "mainGrid", "activityRow"]) {
      expect(LOADING).toContain(piece);
    }
    // The skeleton is CSS-only — a server component with zero client JS.
    expect(LOADING).not.toContain('"use client"');
    expect(LOADING).not.toMatch(/useState|useEffect|canvas|three|lottie/i);
    expect(LOADING_CSS).toContain("overview-skeleton-shimmer");
  });
});

describe("Primary actions (#4, #5)", () => {
  it("Create Sequence routes to /campaigns with a premium CTA", () => {
    expect(CENTER).toMatch(/href="\/campaigns" className=\{styles\.heroCta\}[\s\S]{0,220}Create Sequence/);
  });

  it("Import List routes to /imports", () => {
    expect(CENTER).toMatch(/href="\/imports" className=[\s\S]{0,220}Import List/);
  });

  it("both actions also exist in the blank-workspace empty state", () => {
    const emptyCard = CENTER.slice(CENTER.indexOf("Start your outreach system"));
    expect(emptyCard).toContain('href="/imports"');
    expect(emptyCard).toContain('href="/campaigns"');
    expect(emptyCard).toContain("Import List");
    expect(emptyCard).toContain("Create Sequence");
  });
});

describe("Metrics come from live data (#6, #13)", () => {
  it("the pulse receives only computed dashboard values", () => {
    expect(CENTER).toContain("targeted={runTotals.recipients}");
    expect(CENTER).toContain("delivered={runTotals.delivered}");
    expect(CENTER).toContain("issues={analyticsIssueCount}");
    expect(CENTER).toContain("health={sequenceHealth}");
    expect(CENTER).toContain("successPercent={deliveryMix.successPercent}");
  });

  it("keeps the derived helpers that feed the charts", () => {
    for (const fn of ["buildSequenceHealth", "buildDeliveryMix", "buildAnalyticsPulse", "buildHeroStatusSentence"]) {
      expect(CENTER).toContain(fn);
    }
  });

  it("never hardcodes the screenshot values (8.7K / 8.2K / 299 / 155 / 96%)", () => {
    for (const source of [CENTER, PULSE, LOADING]) {
      expect(source).not.toMatch(/8\.7K|8\.2K/);
      expect(source).not.toMatch(/[>"'\s]299[<"'\s]/);
      expect(source).not.toMatch(/[>"'\s]155[<"'\s]/);
      expect(source).not.toMatch(/[>"'\s]96%/);
    }
  });
});

describe("Empty states (#7)", () => {
  it("a blank workspace gets the premium 'Start your outreach system' card instead of zeroed charts", () => {
    expect(CENTER).toContain("const isBlankWorkspace = campaignCount === 0 && processedImportCount === 0;");
    expect(CENTER).toContain("Start your outreach system");
    expect(CENTER).toContain("Import a list, create a template, then launch your first sequence.");
    // The charts render only on the non-blank branch.
    expect(CENTER).toMatch(/isBlankWorkspace \? \([\s\S]*?\) : \([\s\S]*?<AnalyticsPulse/);
  });

  it("the pulse itself degrades gracefully when a workspace has partial data", () => {
    expect(PULSE).toContain("hasDeliveryData");
    expect(PULSE).toContain("No delivery data yet");
    expect(PULSE).toContain("hasSequences");
    expect(PULSE).toContain("No sequences yet");
  });
});

describe("Interactive metrics (#8, #9, #10)", () => {
  it("activating Delivered reveals a detail card with success rate and an action", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === "delivered"\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\("delivered"\)\}/);
    const delivered = PULSE.slice(PULSE.indexOf('case "delivered":'), PULSE.indexOf('case "issues":'));
    expect(delivered).toContain("Success rate");
    expect(delivered).toContain("View sequences");
    expect(delivered).toContain('"/campaigns"');
  });

  it("activating Issues reveals a detail card with review actions on existing routes", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === "issues"\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\("issues"\)\}/);
    const issues = PULSE.slice(PULSE.indexOf('case "issues":'), PULSE.indexOf("default: {"));
    expect(issues).toContain("Review sequences");
    expect(issues).toContain('"/suppressions"');
    expect(issues).toContain("Issue rate");
  });

  it("every sequence-health segment is activatable and reveals a breakdown", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === slice\.key\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\(slice\.key\)\}/);
    expect(PULSE).toContain("View running sequences");
    expect(PULSE).toContain("View completed sequences");
    expect(PULSE).toContain("View review items");
    expect(PULSE).toContain("Launch a sequence");
    // Only real routes — every detail action points at /campaigns or /suppressions.
    const hrefs = [...PULSE.matchAll(/href: "([^"]+)" as Route/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(["/campaigns", "/suppressions"]).toContain(href);
    }
  });

  it("the donut segments and health bar mirror the same toggle interactions", () => {
    expect(PULSE).toMatch(/donutSegment[\s\S]{0,700}onClick=\{\(\) => toggle\("delivered"\)\}/);
    expect(PULSE).toMatch(/healthSlice[\s\S]{0,700}onClick=\{\(\) => toggle\(slice\.key\)\}/);
    // Hover highlights the matching legend entry.
    expect(PULSE).toContain("onMouseEnter");
    expect(PULSE).toContain("setHovered");
  });

  it("keeps the guided-tour anchors on the interactive chart sections", () => {
    expect(PULSE).toContain('data-overview-tour="delivery-issues"');
    expect(PULSE).toContain('data-overview-tour="sequence-health"');
  });
});

describe("Keyboard + screen-reader accessibility (#11)", () => {
  it("interactive metrics are native buttons, so Enter/Space work without extra handlers", () => {
    const buttonCount = (PULSE.match(/type="button"/g) ?? []).length;
    // Delivered, Issues, 4 health segments (mapped once), and the detail close.
    expect(buttonCount).toBeGreaterThanOrEqual(4);
    expect(PULSE).not.toContain('role="button"');
  });

  it("panels are labelled regions, Escape closes, and the close control has a name", () => {
    expect(PULSE).toContain('role="region"');
    expect(PULSE).toMatch(/aria-controls=\{(deliveryPanelId|healthPanelId)\}/);
    expect(PULSE).toContain('event.key === "Escape"');
    expect(PULSE).toContain('aria-label="Close details"');
  });

  it("charts carry readable text alternatives", () => {
    expect(PULSE).toMatch(/role="img"[\s\S]{0,200}aria-label=\{`Delivery success is/);
    expect(PULSE).toMatch(/role="img"[\s\S]{0,200}aria-label=\{`Sequence health:/);
  });

  it("focus states are visible on the new interactive controls", () => {
    for (const selector of [".metricButton:focus-visible", ".healthButton:focus-visible", ".detailAction:focus-visible"]) {
      expect(PULSE_CSS).toContain(selector);
    }
    expect(CENTER_CSS).toContain(".heroCta:focus-visible");
  });
});

describe("Reduced motion + performance (#12)", () => {
  it("every new stylesheet honours prefers-reduced-motion", () => {
    for (const css of [PULSE_CSS, LOADING_CSS, CENTER_CSS]) {
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    }
    const reducedLoading = LOADING_CSS.slice(LOADING_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedLoading).toMatch(/animation:\s*none/);
    const reducedPulse = PULSE_CSS.slice(PULSE_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedPulse).toMatch(/animation:\s*none/);
    expect(reducedPulse).toMatch(/transition:\s*none/);
  });

  it("adds no heavy dependencies or extra data fetching to the dashboard", () => {
    for (const source of [PULSE, LOADING, CENTER]) {
      expect(source).not.toMatch(/three|gsap|lottie|framer-motion|chart\.js|recharts|d3/i);
    }
    expect(PULSE).not.toMatch(/fetch\(|useSWR|useQuery|setInterval/);
  });
});

describe("Scope: no unrelated routes changed (#14)", () => {
  it("only the workspace route gained a loading state", () => {
    const appDir = "src/app/(app)";
    const routesWithLoading = readdirSync(appDir).filter((entry) =>
      existsSync(path.join(appDir, entry, "loading.tsx"))
    );
    expect(routesWithLoading).toEqual(["workspace"]);
  });

  it("the Analytics Pulse is only used by the Overview command center", () => {
    const componentFiles = readdirSync("src/components", { recursive: true }) as string[];
    const importers = componentFiles
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."))
      .filter((file) => {
        const contents = readFileSync(path.join("src/components", file), "utf8");
        return contents.includes('from "@/components/dashboard/analytics-pulse"');
      });
    expect(importers).toEqual(["dashboard/overview-command-center.tsx"]);
  });
});
