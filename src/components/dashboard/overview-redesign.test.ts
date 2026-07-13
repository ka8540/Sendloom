import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeDeliverySplit } from "@/components/dashboard/delivery-split";

// Unit tests for the delivered/issues percentage pairing plus source-level
// assertions for the Overview command-center redesign, following the repo's
// node-only source-assertion convention (no DOM in the test env). Covers:
// rendering wiring, the interactive Analytics Pulse, the route-level loading
// skeleton, empty states, accessibility, reduced motion, and the
// no-hardcoded-numbers / no-unrelated-routes guarantees.

const CENTER = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const CENTER_CSS = readFileSync("src/components/dashboard/overview-command-center.module.css", "utf8");
const PULSE = readFileSync("src/components/dashboard/analytics-pulse.tsx", "utf8");
const PULSE_CSS = readFileSync("src/components/dashboard/analytics-pulse.module.css", "utf8");
const LOADING = readFileSync("src/components/dashboard/overview-loading.tsx", "utf8");
const LOADING_CSS = readFileSync("src/components/dashboard/overview-loading.module.css", "utf8");
const WORKSPACE_PAGE = readFileSync("src/app/(app)/workspace/page.tsx", "utf8");
const WORKSPACE_LOADING = readFileSync("src/app/(app)/workspace/loading.tsx", "utf8");

describe("Delivered/issues split math (#1, #2)", () => {
  it("pairs the delivered percent with its issue complement (screenshot-scale example)", () => {
    const split = computeDeliverySplit(8200, 299);
    expect(split).not.toBeNull();
    expect(split!.deliveredLabel).toBe("96%");
    expect(split!.issueLabel).toBe("4%");
    expect(split!.deliveredPercent + split!.issuePercent).toBe(100);
  });

  it("always sums the rounded pair to exactly 100", () => {
    const pairs: Array<[number, number]> = [
      [1, 1],
      [965, 35],
      [2, 998],
      [7, 3],
      [123456, 6543],
      [1, 199],
      [3517, 96483]
    ];
    for (const [delivered, issues] of pairs) {
      const split = computeDeliverySplit(delivered, issues)!;
      expect(split.deliveredPercent + split.issuePercent).toBe(100);
      expect(Math.round(split.deliveredShare + split.issueShare)).toBe(100);
    }
  });

  it("keeps sub-1% issue shares visible as <1% with a >99% counterpart (edge #4)", () => {
    const split = computeDeliverySplit(9990, 10)!;
    expect(split.issueLabel).toBe("<1%");
    expect(split.deliveredLabel).toBe(">99%");
    // The rounded pair still holds — a non-zero side never reads 0 or 100.
    expect(split.issuePercent).toBe(1);
    expect(split.deliveredPercent).toBe(99);
  });

  it("mirrors the clamp when delivered is the sub-1% side", () => {
    const split = computeDeliverySplit(1, 500)!;
    expect(split.deliveredLabel).toBe("<1%");
    expect(split.issueLabel).toBe(">99%");
  });

  it("returns null with no outcome data so the UI can show its empty state (edge #1)", () => {
    expect(computeDeliverySplit(0, 0)).toBeNull();
    expect(computeDeliverySplit(-5, 0)).toBeNull();
  });

  it("handles one-sided outcomes (edges #2 and #3)", () => {
    const allDelivered = computeDeliverySplit(1200, 0)!;
    expect(allDelivered.deliveredLabel).toBe("100%");
    expect(allDelivered.issueLabel).toBe("0%");

    const allIssues = computeDeliverySplit(0, 42)!;
    expect(allIssues.deliveredLabel).toBe("0%");
    expect(allIssues.issueLabel).toBe("100%");
  });

  it("handles very large totals without drift (edge #5)", () => {
    const split = computeDeliverySplit(12_400_000, 517_000)!;
    expect(split.deliveredPercent + split.issuePercent).toBe(100);
    expect(split.total).toBe(12_917_000);
    expect(split.issueLabel).toBe("4%");
  });
});

describe("Overview dashboard renders as one main block (#1, #2, #3)", () => {
  // Everything between the hero opening and the summary cards — the main
  // dashboard block. Analytics + health must live inside it.
  const heroBlock = CENTER.slice(
    CENTER.indexOf('data-overview-tour="page-intro"'),
    CENTER.indexOf("<OverviewSummary")
  );

  it("the /workspace route renders the redesigned command center", () => {
    expect(WORKSPACE_PAGE).toContain('export { default } from "@/components/dashboard/overview-command-center"');
    expect(CENTER).toContain("styles.heroTitle}>Overview</h1>");
    expect(CENTER).toContain('data-overview-tour="page-intro"');
  });

  it("keeps identity, actions, and analytics inside the single hero block — no sibling sections", () => {
    // No <section> opens inside the hero slice: the pulse and the health rail
    // are children of the one main card, not separate deck cards.
    expect((heroBlock.match(/<section/g) ?? []).length).toBe(0);
    expect(heroBlock).toContain("<AnalyticsPulse");
    expect(heroBlock).toContain("styles.heroActionCard");
    expect(heroBlock).toContain("styles.heroInsights");
    // The old split-layout sections are gone.
    expect(CENTER).not.toContain("pulseDeck");
    expect(CENTER).not.toContain("startSection");
  });

  it("mounts the interactive Analytics Pulse inside the hero insights", () => {
    expect(CENTER).toContain("<AnalyticsPulse");
    expect(CENTER).toContain('data-overview-tour="workspace-health"');
    // The sequence-health module renders inside the same client component the
    // hero embeds, so it also stays inside the main block.
    expect(PULSE).toContain('data-overview-tour="sequence-health"');
  });

  it("keeps hero copy short — the long launch paragraph stays gone", () => {
    expect(CENTER).toContain("Launch, import, or review what needs attention.");
    expect(CENTER).not.toContain("jump straight into a recent run");
    expect(CENTER).not.toContain("Move from signal to action");
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

  it("mirrors the compact panel: identity + stat tiles, action card with ring and health rail", () => {
    for (const piece of [
      "heroIdentity",
      "highlightRow",
      "actionCard",
      "ctaRow",
      "insightStack",
      "donutRing",
      "donutCore",
      "metricRow",
      "railBar",
      "healthChips",
      "summaryRow",
      "mainGrid",
      "activityRow"
    ]) {
      expect(LOADING).toContain(piece);
    }
    // The skeleton is CSS-only — a server component with zero client JS.
    expect(LOADING).not.toContain('"use client"');
    expect(LOADING).not.toMatch(/useState|useEffect|canvas|three|lottie/i);
    expect(LOADING_CSS).toContain("overview-skeleton-shimmer");
  });

  it("keeps the skeleton's ring and health rail inside the one hero block (#10)", () => {
    const heroSkeleton = LOADING.slice(LOADING.indexOf("styles.hero}"), LOADING.indexOf("</section>"));
    expect((heroSkeleton.match(/<section/g) ?? []).length).toBe(0);
    expect(heroSkeleton).toContain("donutRing");
    expect(heroSkeleton).toContain("healthChips");
    expect(LOADING).not.toContain("pulseDeck");
    expect(LOADING).not.toContain("statStrip");
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
  it("the pulse receives only raw computed dashboard counts", () => {
    expect(CENTER).toContain("targeted={runTotals.recipients}");
    expect(CENTER).toContain("delivered={runTotals.delivered}");
    expect(CENTER).toContain("issues={analyticsIssueCount}");
    expect(CENTER).toContain("health={sequenceHealth}");
    // No precomputed percentages cross the boundary — the paired split has a
    // single owner inside the client component.
    expect(CENTER).not.toContain("successPercent=");
    expect(PULSE).toContain('from "@/components/dashboard/delivery-split"');
    expect(PULSE).toMatch(/useMemo\(\(\) => computeDeliverySplit\(delivered, issues\)/);
  });

  it("keeps the derived helpers that feed the charts", () => {
    expect(CENTER).toContain("buildSequenceHealth");
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
    // A null split (zero outcomes) renders the empty state instead of charts.
    expect(PULSE).toMatch(/\{split \? \(/);
    expect(PULSE).toContain("No delivery data yet");
    expect(PULSE).toContain("hasSequences");
    expect(PULSE).toContain("No sequences yet");
  });
});

describe("Interactive metrics (#3, #4, #5, #6, #8, #9, #10)", () => {
  it("activating Delivered pins a detail that pairs the success percent with the issue share", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === "delivered"\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\("delivered"\)\}/);
    const delivered = PULSE.slice(PULSE.indexOf('eyebrow: "Delivered"'), PULSE.indexOf('eyebrow: "Issues"'));
    expect(delivered).toContain("${split.deliveredLabel} successful");
    expect(delivered).toContain("${split.issueLabel} issues");
    expect(delivered).toContain("stats: [deliveredStat, issueStat, targetedStat]");
    expect(delivered).toContain("View sequences");
    expect(delivered).toContain('"/campaigns"');
    // The stats always include the delivered count, issue count, and targeted total.
    expect(PULSE).toContain('{ label: "Targeted", value: formatCompactNumber(Math.max(targeted, split.total)) }');
  });

  it("activating Issues pins a detail that pairs the issue percent with the delivered share", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === "issues"\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\("issues"\)\}/);
    const issues = PULSE.slice(PULSE.indexOf('eyebrow: "Issues"'), PULSE.indexOf("function buildHealthDetail"));
    expect(issues).toContain("${split.issueLabel} need attention");
    expect(issues).toContain("${split.deliveredLabel} delivered");
    expect(issues).toContain("Review sequences");
    expect(issues).toContain('"/suppressions"');
  });

  it("the ring center is minimal — one figure, no multi-line text (#7)", () => {
    // The center holds a single <strong>; the mode word sits below the ring
    // (donutCaption) and the paired share lives in the metric rows beside it.
    const center = PULSE.slice(PULSE.indexOf("styles.donutCenter}"), PULSE.indexOf("styles.donutCaption"));
    expect((center.match(/<strong/g) ?? []).length).toBe(1);
    expect(center).not.toContain("<small");
    expect(center).not.toContain("<em");
    expect(PULSE).not.toContain("donutCenterPaired");
    // Keyed swap so switching Delivered <-> Issues animates the reading.
    expect(PULSE).toMatch(/<strong key=\{centerMode\}/);
    expect(PULSE_CSS).toContain("pulse-center-in");
  });

  it("both shares stay visible outside the chart at rest", () => {
    // The metric rows always render count + share for BOTH sides, so a 0%
    // issues state reads as a compact row, never crammed into the circle.
    expect(PULSE).toContain("{split.deliveredLabel}");
    expect(PULSE).toContain("{split.issueLabel}");
    expect(PULSE).toMatch(/metricRow[\s\S]{0,900}\{split\.deliveredLabel\}/);
    expect(PULSE).toMatch(/data-key="issues"[\s\S]{0,900}\{split\.issueLabel\}/);
  });

  it("both metric cards show count and share side by side", () => {
    expect(PULSE).toContain("metricShare");
    const shareBadges = (PULSE.match(/styles\.metricShare/g) ?? []).length;
    expect(shareBadges).toBe(2);
  });

  it("every sequence-health segment is activatable and reveals a breakdown with its share", () => {
    expect(PULSE).toMatch(/aria-expanded=\{selected === slice\.key\}/);
    expect(PULSE).toMatch(/onClick=\{\(\) => toggle\(slice\.key\)\}/);
    expect(PULSE).toContain("View running sequences");
    expect(PULSE).toContain("View completed sequences");
    expect(PULSE).toContain("View review items");
    expect(PULSE).toContain("Launch a sequence");
    // The health detail includes count, share of all sequences, and the total.
    expect(PULSE).toContain('label: "Share"');
    expect(PULSE).toContain('label: "All sequences"');
    // Only real routes — every detail action points at /campaigns or /suppressions.
    const hrefs = [...PULSE.matchAll(/href: "([^"]+)" as Route/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(["/campaigns", "/suppressions"]).toContain(href);
    }
  });

  it("the donut segments and health bar mirror the same toggle interactions (#7)", () => {
    expect(PULSE).toMatch(/donutSegment[\s\S]{0,900}onClick=\{\(\) => toggle\("delivered"\)\}/);
    expect(PULSE).toMatch(/healthSlice[\s\S]{0,900}onClick=\{\(\) => toggle\(slice\.key\)\}/);
    // Hover/focus previews the matching segment before a click pins it.
    expect(PULSE).toContain("onMouseEnter: () => setHovered(selection)");
    expect(PULSE).toContain("onFocus: () => setHovered(selection)");
  });

  it("switching selections re-animates the pinned detail card", () => {
    expect(PULSE).toMatch(/<DetailCard key=\{selected\}/);
  });

  it("keeps the guided-tour anchors on the interactive chart sections", () => {
    expect(PULSE).toContain('data-overview-tour="delivery-issues"');
    expect(PULSE).toContain('data-overview-tour="sequence-health"');
  });
});

describe("Keyboard + screen-reader accessibility (#8, #11)", () => {
  it("metric cards and legend entries are native buttons, so Enter/Space work without extra handlers", () => {
    const buttonCount = (PULSE.match(/type="button"/g) ?? []).length;
    // Delivered, Issues, 4 health segments (mapped once), and the detail close.
    expect(buttonCount).toBeGreaterThanOrEqual(4);
  });

  it("donut arcs and health-bar slices are named, focusable, keyboard-activatable buttons", () => {
    // Two SVG arcs + the mapped bar slice — each with role, tab stop, name, and pressed state.
    expect((PULSE.match(/role="button"/g) ?? []).length).toBe(3);
    expect((PULSE.match(/tabIndex=\{0\}/g) ?? []).length).toBe(3);
    expect(PULSE).toMatch(/aria-label=\{`Delivered segment: \$\{split\.deliveredLabel\}/);
    expect(PULSE).toMatch(/aria-label=\{`Issues segment: \$\{split\.issueLabel\}/);
    expect(PULSE).toMatch(/aria-label=\{`\$\{slice\.label\}: /);
    // Enter/Space activate through the shared segment handler.
    expect(PULSE).toContain('event.key === "Enter" || event.key === " "');
    expect((PULSE.match(/onKeyDown=\{segmentKeyDown\(/g) ?? []).length).toBe(3);
  });

  it("selection is announced via aria-pressed on every interactive metric", () => {
    // Delivered arc + card, issues arc + card, health slice + legend button.
    expect((PULSE.match(/aria-pressed=\{selected === "delivered"\}/g) ?? []).length).toBe(2);
    expect((PULSE.match(/aria-pressed=\{selected === "issues"\}/g) ?? []).length).toBe(2);
    expect((PULSE.match(/aria-pressed=\{selected === slice\.key\}/g) ?? []).length).toBe(2);
  });

  it("panels are labelled regions, Escape closes, and the close control has a name", () => {
    expect(PULSE).toContain('role="region"');
    expect(PULSE).toMatch(/aria-controls=\{(deliveryPanelId|healthPanelId)\}/);
    expect(PULSE).toContain('event.key === "Escape"');
    expect(PULSE).toContain('aria-label="Close details"');
  });

  it("charts carry readable text alternatives naming both shares", () => {
    expect(PULSE).toMatch(/role="group"[\s\S]{0,260}aria-label=\{`Delivery outcomes: \$\{split\.deliveredLabel\} delivered/);
    expect(PULSE).toMatch(/role="group"[\s\S]{0,200}aria-label=\{`Sequence health:/);
    // The detail names its metric in text, so color is never the only signal.
    expect(PULSE).toContain("detailEyebrow");
  });

  it("focus states are visible on the new interactive controls, including SVG segments", () => {
    for (const selector of [
      ".metricRow:focus-visible",
      ".healthChip:focus-visible",
      ".detailAction:focus-visible",
      ".donutSegment:focus-visible",
      ".healthSlice:focus-visible"
    ]) {
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
  it("only routes with redesigned loading states ship a loading.tsx", () => {
    const appDir = "src/app/(app)";
    const routesWithLoading = readdirSync(appDir).filter((entry) =>
      existsSync(path.join(appDir, entry, "loading.tsx"))
    );
    // workspace = Overview redesign; campaigns = Sequences command-center redesign.
    expect(routesWithLoading).toEqual(["campaigns", "workspace"]);
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
