import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Source-level assertions for the minimal Overview redesign, following the
// repo's node-only source-assertion convention (no DOM in the test env).
// Pins: the compact header + pill actions, the four-part summary strip (no
// duplicated send capacity), quick actions before recent sequences, the
// three-item sequence preview with one rounded search + one View all button,
// the right-column Gmail send window + concise activity feed, the loading
// skeleton, accessibility, reduced motion, and the no-hardcoded-numbers /
// no-new-dependencies guarantees.

const CENTER = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const CENTER_CSS = readFileSync("src/components/dashboard/overview-command-center.module.css", "utf8");
const PANEL = readFileSync("src/components/dashboard/sequence-panel.tsx", "utf8");
const ROW = readFileSync("src/components/dashboard/sequence-row.tsx", "utf8");
const ACTIONS = readFileSync("src/components/dashboard/sequence-row-actions.tsx", "utf8");
const ACTIVITY = readFileSync("src/components/dashboard/activity-feed.tsx", "utf8");
const SEND_WINDOW = readFileSync("src/components/dashboard/overview-send-window.tsx", "utf8");
const LOADING = readFileSync("src/components/dashboard/overview-loading.tsx", "utf8");
const LOADING_CSS = readFileSync("src/components/dashboard/overview-loading.module.css", "utf8");
const WORKSPACE_PAGE = readFileSync("src/app/(app)/workspace/page.tsx", "utf8");
const WORKSPACE_LOADING = readFileSync("src/app/(app)/workspace/loading.tsx", "utf8");

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} exists`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("Page header (#8, #9, #10)", () => {
  it("the /workspace route renders the redesigned Overview", () => {
    expect(WORKSPACE_PAGE).toContain('export { default } from "@/components/dashboard/overview-command-center"');
    expect(CENTER).toContain("styles.pageTitle}>Overview</h1>");
    expect(CENTER).toContain("Here’s what’s happening with your outreach.");
    expect(CENTER).toContain('data-overview-tour="page-intro"');
  });

  it("keeps the heading prominent but not enormous — the giant hero is gone", () => {
    expect(cssRule(CENTER_CSS, ".pageTitle")).toContain("clamp(1.9rem, 3vw, 2.35rem)");
    expect(CENTER).not.toContain("Command center");
    expect(CENTER).not.toContain("heroEyebrow");
    expect(CENTER_CSS).not.toMatch(/font-size: clamp\(2\.75rem/);
  });

  it("Create Sequence and Import List are visibly rounded pills with preserved routes", () => {
    expect(CENTER).toMatch(/href="\/campaigns" className=\{styles\.primaryAction\}[\s\S]{0,160}Create Sequence/);
    expect(CENTER).toMatch(/href="\/imports" className=\{styles\.secondaryAction\}[\s\S]{0,160}Import List/);
    const shared = cssRule(CENTER_CSS, ".primaryAction,");
    expect(shared).toContain("border-radius: 999px");
    // No gradient, glow, or scale animation on the page actions.
    expect(shared).not.toMatch(/gradient|scale\(/);
  });
});

describe("Summary strip (#11–#15)", () => {
  const strip = CENTER.slice(CENTER.indexOf("styles.summaryStrip"), CENTER.indexOf("styles.mainGrid"));

  it("contains exactly the four operational sections", () => {
    for (const label of ["Active sequences", "Sent (24h)", "Needs attention", "Lists ready"]) {
      expect(strip).toContain(label);
    }
    expect((strip.match(/styles\.summaryCell/g) ?? []).length).toBe(4);
  });

  it("renders live values, never the mockup numbers", () => {
    expect(strip).toContain("formatCompactNumber(activeSequenceCount)");
    expect(strip).toContain("formatCompactNumber(sentLastDayCount)");
    expect(strip).toContain("formatCompactNumber(needsAttentionCount)");
    expect(strip).toContain("formatCompactNumber(readyListCount)");
    for (const source of [CENTER, PANEL, ROW, ACTIVITY, SEND_WINDOW, LOADING]) {
      expect(source).not.toMatch(/[>"'\s]155[<"'\s]/);
      expect(source).not.toMatch(/[>"'\s]450[<"'\s]/);
      expect(source).not.toMatch(/[>"'\s]295[<"'\s]/);
    }
  });

  it("does not duplicate Gmail send capacity in the strip", () => {
    expect(strip).not.toContain("Gmail");
    expect(strip).not.toContain("sentLast24h");
    expect(strip).not.toContain(".limit");
    expect(strip).not.toContain("remaining");
  });

  it("is one bordered container with hairline dividers, not floating cards", () => {
    expect(cssRule(CENTER_CSS, ".summaryStrip")).toContain("border: 1px solid var(--line)");
    expect(CENTER_CSS).toMatch(/\.summaryCell \+ \.summaryCell \{\s*border-left: 1px solid var\(--line\);/);
  });

  it("keeps the tour anchors on the strip sections", () => {
    expect(strip).toContain('data-overview-tour="workspace-health"');
    expect(strip).toContain('data-overview-tour="active-sequences"');
    expect(strip).toContain('data-overview-tour="needs-attention"');
    expect(strip).toContain('data-overview-tour="lists-ready"');
  });
});

describe("Quick actions (#18, #19, #20)", () => {
  it("appear before Recent sequences in the main column", () => {
    expect(CENTER.indexOf("Quick actions")).toBeGreaterThan(0);
    expect(CENTER.indexOf("Quick actions")).toBeLessThan(CENTER.indexOf("<SequencePanel"));
    expect(CENTER).toContain("Start something new.");
  });

  it("exactly three compact cards with existing routes and line icons", () => {
    const quick = CENTER.slice(CENTER.indexOf("styles.quickGrid"), CENTER.indexOf("<SequencePanel"));
    expect((quick.match(/styles\.quickCard/g) ?? []).length).toBe(3);
    expect(quick).toContain('href="/campaigns"');
    expect(quick).toContain('href="/imports"');
    expect(quick).toContain('href="/templates"');
    for (const icon of ["CirclePlus", "FileUp", "FileText"]) {
      expect(quick).toContain(`<${icon} `);
    }
    // Compact height and no hover movement.
    expect(cssRule(CENTER_CSS, ".quickCard")).toContain("min-height: 4.9rem");
    expect(CENTER_CSS).not.toMatch(/quickCard:hover \{[^}]*transform/);
  });
});

describe("Recent sequences preview (#21–#28)", () => {
  it("shows at most three rows and has no pagination", () => {
    expect(PANEL).toContain("const RECENT_SEQUENCES_LIMIT = 3;");
    expect(PANEL).toContain(".slice(0, RECENT_SEQUENCES_LIMIT)");
    expect(PANEL).not.toMatch(/pagination|ChevronLeft|ChevronRight|currentPage/i);
  });

  it("has exactly one rounded View all sequences button", () => {
    expect((PANEL.match(/View all sequences/g) ?? []).length).toBe(1);
    expect(PANEL).toMatch(/href="\/campaigns" className=\{styles\.viewAllButton\}/);
    expect(cssRule(CENTER_CSS, ".viewAllButton")).toContain("border-radius: 999px");
  });

  it("keeps a labelled, rounded search field with preserved client-side behavior", () => {
    expect(PANEL).toContain('aria-label="Search recent sequences"');
    expect(PANEL).toContain('placeholder="Search sequences…"');
    expect(PANEL).toMatch(/row\.name\.toLowerCase\(\)\.includes\(normalizedQuery\)/);
    expect(PANEL).toMatch(/row\.summary\.toLowerCase\(\)\.includes\(normalizedQuery\)/);
    expect(cssRule(CENTER_CSS, ".sequenceSearch input")).toContain("border-radius: 999px");
    // Focus keeps the shape and adds a visible ring without layout shift.
    expect(CENTER_CSS).toMatch(/\.sequenceSearch input:focus \{[^}]*box-shadow/);
    // The dropped filter/sort toolbar stays gone.
    expect(PANEL).not.toMatch(/toolbarSelect|scheduleType|setSort|setStatus/);
  });

  it("preserves the live-refresh behavior for active runs", () => {
    expect(PANEL).toContain("OVERVIEW_REFRESH_INTERVAL_MS");
    expect(PANEL).toContain("router.refresh()");
    expect(PANEL).toContain("visibilitychange");
    expect(PANEL).toContain("startRefreshWindow");
  });

  it("rows are generously rounded cards showing name, chips, status, and time from real data", () => {
    expect(cssRule(CENTER_CSS, ".sequenceRow")).toContain("border-radius: 24px");
    for (const piece of [
      "sequence.name",
      "sequence.meta.list",
      "sequence.meta.template",
      "sequence.meta.sender",
      "sequence.statusLabel",
      "sequence.lastActivityLabel"
    ]) {
      expect(ROW).toContain(piece);
    }
    expect(ROW).toContain('data-tone={sequence.statusTone}');
    // The row stays keyboard-activatable.
    expect(ROW).toContain("tabIndex={0}");
    expect(ROW).toMatch(/event\.key === "Enter" \|\| event\.key === " "/);
  });

  it("status badges are compact rounded pills with semantic tones", () => {
    expect(cssRule(CENTER_CSS, ".sequenceStatus")).toContain("border-radius: 999px");
    for (const tone of ["running", "completed", "paused", "failed", "scheduled", "draft"]) {
      expect(CENTER_CSS).toContain(`.sequenceStatus[data-tone="${tone}"]`);
    }
  });

  it("actions are circular, labelled icon buttons with all states preserved", () => {
    const rule = cssRule(CENTER_CSS, ".actionButton {");
    expect(rule).toContain("width: 2.5rem");
    expect(rule).toContain("height: 2.5rem");
    expect(rule).toContain("border-radius: 999px");
    for (const piece of [
      "aria-label={`View ${campaignName}`}",
      "aria-label={`Pause ${campaignName}`}",
      "aria-label={`Resume ${campaignName}`}",
      "aria-label={`Delete ${campaignName}`}",
      "handleRelaunch",
      "isDailyLimitBlocked"
    ]) {
      expect(ACTIONS).toContain(piece);
    }
    // Delete stays restrained: an icon button with a tinted treatment, plus the
    // existing confirm dialog.
    expect(ACTIONS).toContain("actionButtonDanger");
    expect(ACTIONS).toContain("<AppConfirmDialog");
  });

  it("actions expand on hover/focus into labelled capsules without transforms", () => {
    // Every action carries its expanded label; the Open arrow is a real link.
    for (const label of ["View", "Pause", "Resume", "Relaunch", "Delete"]) {
      expect(ACTIONS).toContain(`<span className={styles.actionLabel}>${label}</span>`);
    }
    expect(ROW).toContain("<span className={styles.actionLabel}>Open</span>");
    expect(ROW).toContain("aria-label={`Open ${sequence.name}`}");
    // Width-based expansion with the label revealed via max-width/opacity.
    expect(CENTER_CSS).toMatch(/\.actionButton:hover,\s*\.actionButton:focus-visible \{[^}]*width: var\(--action-expanded-width\)/);
    expect(CENTER_CSS).toMatch(/\.actionButton:hover \.actionLabel,\s*\.actionButton:focus-visible \.actionLabel \{[^}]*max-width/);
    // No transform/scale/shadow animation on the buttons themselves.
    const actionRules = CENTER_CSS.slice(CENTER_CSS.indexOf(".actionButton {"), CENTER_CSS.indexOf(".spin {"));
    expect(actionRules).not.toMatch(/transform|scale\(|box-shadow/);
    // The rail is right-anchored so expansion never reflows the row.
    expect(cssRule(CENTER_CSS, ".sequenceActions")).toContain("justify-content: flex-end");
    // Tooltips stay available for the compact state.
    for (const title of ['title="View"', 'title="Pause"', 'title="Resume"', 'title="Delete"']) {
      expect(ACTIONS).toContain(title);
    }
    expect(ROW).toContain('title="Open"');
  });
});

describe("Gmail send window (#16, #17)", () => {
  it("stays in the right column with real windowed data", () => {
    expect(CENTER).toMatch(/<aside className=\{styles\.sideColumn\}>[\s\S]{0,200}<SendWindowCard/);
    for (const piece of [
      "combined.sentLast24h.toLocaleString()",
      "combined.limit.toLocaleString()",
      "combined.remaining.toLocaleString()",
      'role="progressbar"',
      "LocalDateTime",
      "ledgerAvailable"
    ]) {
      expect(SEND_WINDOW).toContain(piece);
    }
    expect(SEND_WINDOW).toContain('data-overview-tour="gmail-send-window"');
    expect(SEND_WINDOW).toContain('data-overview-tour="gmail-progress"');
    expect(SEND_WINDOW).toContain('data-overview-tour="sender-breakdown"');
  });

  it("keeps the app's real Google mark, not a generic or redrawn mail icon", () => {
    for (const fill of ["#4285F4", "#34A853", "#FBBC04", "#EA4335"]) {
      expect(SEND_WINDOW).toContain(`fill="${fill}"`);
    }
    // The exact paths from the existing auth-page asset.
    expect(SEND_WINDOW).toContain("M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84");
    expect(SEND_WINDOW).not.toMatch(/<Mail\b|MailCheck/);
  });
});

describe("Recent activity (#31, #32)", () => {
  it("drops the raw System log prefix and the noisy live badge", () => {
    expect(ACTIVITY).not.toContain("System log:");
    expect(ACTIVITY).not.toContain("Flowing now");
  });

  it("keeps concise icon + title + description + timestamp rows from real items", () => {
    for (const piece of ["getActivityIcon", "getActivityTone", "item.title", "item.description", "item.timeLabel"]) {
      expect(ACTIVITY).toContain(piece);
    }
    expect(ACTIVITY).toContain('data-overview-tour="live-system"');
    expect(ACTIVITY).toContain('data-overview-tour={index === 0 ? "activity-row" : undefined}');
    // No invented View-all route — there is no user-facing activity page.
    expect(ACTIVITY).not.toMatch(/View all/);
    // The concise subset limit lives in the shared builder.
    expect(readFileSync("src/components/dashboard/activity-builder.ts", "utf8")).toContain("const ACTIVITY_LIMIT = 7");
  });
});

describe("Removed analytics presentation (#36, #37)", () => {
  it("the Analytics Pulse and old summary cards are gone from the Overview", () => {
    expect(CENTER).not.toMatch(/AnalyticsPulse|analytics-pulse|OverviewSummary|delivery-split|buildSequenceHealth/);
    expect(existsSync("src/components/dashboard/analytics-pulse.tsx")).toBe(false);
    expect(existsSync("src/components/dashboard/overview-summary.tsx")).toBe(false);
    expect(existsSync("src/components/dashboard/delivery-split.ts")).toBe(false);
  });

  it("no charts or chart libraries were added", () => {
    for (const source of [CENTER, PANEL, ROW, ACTIVITY, SEND_WINDOW, LOADING]) {
      expect(source).not.toMatch(/from "(three|gsap|lottie|framer-motion|chart\.js|recharts|d3)/i);
      expect(source).not.toMatch(/donut|<svg viewBox="0 0 36 36"/i);
    }
  });

  it("no analytics page or route was created", () => {
    expect(existsSync("src/app/(app)/analytics")).toBe(false);
  });
});

describe("Loading skeleton", () => {
  it("the workspace route keeps a dedicated CSS-only loading state", () => {
    expect(WORKSPACE_LOADING).toContain('export { default } from "@/components/dashboard/overview-loading"');
    expect(LOADING).toContain('role="status"');
    expect(LOADING).toContain('aria-busy="true"');
    expect(LOADING).toContain("srOnly");
    expect(LOADING).not.toContain('"use client"');
    expect(LOADING).not.toMatch(/useState|useEffect|spinner|Loader2/);
    expect(LOADING_CSS).toContain("overview-skeleton-shimmer");
  });

  it("mirrors the new layout: header pills, summary strip, quick cards, rows, side cards", () => {
    for (const piece of [
      "pageHeader",
      "actionPill",
      "summaryStrip",
      "quickGrid",
      "sequenceHead",
      "searchPill",
      "rowCard",
      "sideCard",
      "activityRow"
    ]) {
      expect(LOADING).toContain(piece);
    }
  });
});

describe("Theming, motion, and layout", () => {
  it("both columns come from one grid with a clearly wider main column", () => {
    expect(cssRule(CENTER_CSS, ".mainGrid")).toContain("minmax(0, 2.15fr) minmax(20.5rem, 1fr)");
    // Stacks on smaller screens without horizontal overflow.
    expect(CENTER_CSS).toMatch(/@media \(max-width: 1240px\) \{\s*\.mainGrid \{\s*grid-template-columns: 1fr;/);
  });

  it("dark mode reuses theme tokens instead of a hardcoded second palette", () => {
    expect(CENTER_CSS).toContain("var(--surface)");
    expect(CENTER_CSS).toContain("var(--line)");
    expect(CENTER_CSS).toContain("var(--accent)");
    expect(CENTER_CSS).toContain(':global(html[data-theme="dark"]) .page');
    expect(CENTER_CSS).toContain("@media (prefers-color-scheme: dark)");
  });

  it("focus is visible on every interactive control", () => {
    for (const selector of [
      ".primaryAction:focus-visible",
      ".secondaryAction:focus-visible",
      ".quickCard:focus-visible",
      ".viewAllButton:focus-visible",
      ".sequenceRow:focus-visible",
      ".actionButton:focus-visible",
      ".sendCard:focus-visible",
      ".activityItem:focus-visible"
    ]) {
      expect(CENTER_CSS).toContain(selector);
    }
  });

  it("honours prefers-reduced-motion in both stylesheets", () => {
    for (const css of [CENTER_CSS, LOADING_CSS]) {
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
      const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
      expect(reduced).toMatch(/animation:\s*none|transition:\s*none/);
    }
  });
});
