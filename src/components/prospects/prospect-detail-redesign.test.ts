import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildQualitySegments,
  deriveDiscoverQualitySummary,
  describeQualitySummary,
  qualityPercent,
  resolveNextEmailFormatMode,
  type EmailFormatActionMode
} from "@/components/prospects/prospect-view";

const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const CSS = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");
const CLIENT_GRAPHQL = readFileSync("src/components/prospects/prospect-graphql.ts", "utf8");

// A realistic 40-person result: 12 high, 14 medium, 5 low, 5 unavailable,
// 2 invalid, 1 suppressed, 1 verified.
const SAMPLE_COUNTS = [
  { status: "VERIFIED", count: 1 },
  { status: "INFERRED_HIGH", count: 12 },
  { status: "INFERRED_MEDIUM", count: 14 },
  { status: "INFERRED_LOW", count: 5 },
  { status: "UNAVAILABLE", count: 5 },
  { status: "INVALID", count: 2 },
  { status: "SUPPRESSED", count: 1 }
];

// ---------------------------------------------------------------------------
// Data quality — the summary is derived from real person statuses.
// ---------------------------------------------------------------------------

describe("Discover quality summary derivation", () => {
  it("counts total, usable, unavailable, invalid, suppressed, and needs-review from person statuses", () => {
    const summary = deriveDiscoverQualitySummary(SAMPLE_COUNTS);
    expect(summary.total).toBe(40);
    // usable mirrors export eligibility: VERIFIED + all INFERRED_* levels.
    expect(summary.usable).toBe(32);
    expect(summary.unavailable).toBe(5);
    expect(summary.invalid).toBe(2);
    expect(summary.suppressed).toBe(1);
    // needsReview is the documented overlapping subset of usable (INFERRED_LOW).
    expect(summary.needsReview).toBe(5);
    expect(summary.verified).toBe(1);
  });

  it("never double-counts: the exclusive categories sum to the total", () => {
    const summary = deriveDiscoverQualitySummary(SAMPLE_COUNTS);
    expect(summary.usable + summary.unavailable + summary.invalid + summary.suppressed).toBe(summary.total);
  });

  it("treats unknown legacy statuses as unavailable rather than inventing a category", () => {
    const summary = deriveDiscoverQualitySummary([{ status: "SOMETHING_LEGACY", count: 3 }]);
    expect(summary.total).toBe(3);
    expect(summary.unavailable).toBe(3);
    expect(summary.usable).toBe(0);
  });

  it("handles empty, null, and malformed counts without NaN", () => {
    for (const input of [[], null, undefined, [{ status: "INFERRED_HIGH", count: Number.NaN }]]) {
      const summary = deriveDiscoverQualitySummary(input);
      for (const value of Object.values(summary)) {
        expect(Number.isNaN(value)).toBe(false);
      }
      expect(summary.total).toBe(0);
    }
  });

  it("zero-safe percentages never produce NaN", () => {
    expect(qualityPercent(0, 0)).toBe(0);
    expect(qualityPercent(5, 0)).toBe(0);
    expect(qualityPercent(Number.NaN, 40)).toBe(0);
    expect(qualityPercent(32, 40)).toBe(80);
  });
});

describe("Discover quality segments (visualization)", () => {
  it("builds mutually exclusive segments whose shares total 100%", () => {
    const segments = buildQualitySegments(SAMPLE_COUNTS);
    const totalShare = segments.reduce((sum, segment) => sum + segment.share, 0);
    expect(Math.round(totalShare)).toBe(100);
    const totalCount = segments.reduce((sum, segment) => sum + segment.count, 0);
    expect(totalCount).toBe(40);
  });

  it("omits zero-count statuses so the legend never renders empty rows", () => {
    const segments = buildQualitySegments([
      { status: "INFERRED_HIGH", count: 4 },
      { status: "SUPPRESSED", count: 0 }
    ]);
    expect(segments.map((segment) => segment.status)).toEqual(["INFERRED_HIGH"]);
  });

  it("returns no segments for a zero-result search (the empty state renders instead)", () => {
    expect(buildQualitySegments([])).toEqual([]);
    expect(buildQualitySegments(null)).toEqual([]);
  });

  it("labels every segment with the People-table badge vocabulary (color is never the only signal)", () => {
    const segments = buildQualitySegments(SAMPLE_COUNTS);
    expect(segments.map((segment) => segment.label)).toEqual([
      "Verified",
      "Inferred · High",
      "Inferred · Medium",
      "Inferred · Low",
      "Unavailable",
      "Invalid",
      "Suppressed"
    ]);
  });
});

describe("Discover quality accessible summary", () => {
  it("describes the rollup in plain language", () => {
    expect(describeQualitySummary(deriveDiscoverQualitySummary(SAMPLE_COUNTS))).toBe(
      "32 usable, 5 unavailable, 2 invalid, and 1 suppressed out of 40 people."
    );
  });

  it("has a safe zero state", () => {
    expect(describeQualitySummary(deriveDiscoverQualitySummary([]))).toBe(
      "No people with email-quality information yet."
    );
  });

  it("is wired to the visualization as its accessible name", () => {
    expect(DETAIL_SOURCE).toContain('role="img"');
    expect(DETAIL_SOURCE).toContain("aria-label={`Email quality distribution: ${description}`}");
    // The same description renders as a visible caption too.
    expect(DETAIL_SOURCE).toContain("styles.qualityCaption");
  });
});

// ---------------------------------------------------------------------------
// Action-mode bug — the three corrections are one exclusive mode.
// ---------------------------------------------------------------------------

describe("email-format action mode is exclusive", () => {
  it("opens a requested mode and closes the previous one", () => {
    let mode: EmailFormatActionMode = "none";
    mode = resolveNextEmailFormatMode(mode, "source-url");
    expect(mode).toBe("source-url");
    // Fix manually closes source and opens only manual.
    mode = resolveNextEmailFormatMode(mode, "manual-fix");
    expect(mode).toBe("manual-fix");
  });

  it("re-pressing the active mode closes it", () => {
    expect(resolveNextEmailFormatMode("source-url", "source-url")).toBe("none");
    expect(resolveNextEmailFormatMode("manual-fix", "manual-fix")).toBe("none");
  });

  it("repeated presses of another mode can never stack editors", () => {
    let mode: EmailFormatActionMode = "manual-fix";
    mode = resolveNextEmailFormatMode(mode, "source-url");
    mode = resolveNextEmailFormatMode(mode, "source-url");
    // Toggled open then closed — never two open at once.
    expect(mode).toBe("none");
  });
});

describe("detail view uses one controlled mode (no independent booleans)", () => {
  it("holds a single EmailFormatActionMode state initialised to none", () => {
    expect(DETAIL_SOURCE).toContain('useState<EmailFormatActionMode>("none")');
  });

  it("the old independent editor booleans are gone", () => {
    expect(DETAIL_SOURCE).not.toContain("showFormatSource");
    expect(DETAIL_SOURCE).not.toContain("showManualFormat");
  });

  it("renders the editors inside ONE stable container that swaps by mode", () => {
    expect(DETAIL_SOURCE).toContain("styles.editorShell");
    // Exactly one editor shell exists.
    expect(DETAIL_SOURCE.split("styles.editorShell").length - 1).toBe(1);
    // Each editor renders only for its own mode.
    expect(DETAIL_SOURCE).toContain('actionMode === "source-url" && (');
    expect(DETAIL_SOURCE).toContain('actionMode === "manual-fix" && (');
    expect(DETAIL_SOURCE).toContain('actionMode === "ai-refresh" && (');
    // The active mode is observable for tests/tour tooling.
    expect(DETAIL_SOURCE).toContain("data-discover-action-mode={actionMode}");
  });

  it("mode buttons expose pressed state and route through the exclusive resolver", () => {
    expect(DETAIL_SOURCE).toContain('aria-pressed={actionMode === "source-url"}');
    expect(DETAIL_SOURCE).toContain('aria-pressed={actionMode === "manual-fix"}');
    expect(DETAIL_SOURCE).toContain("resolveNextEmailFormatMode(current, requested)");
  });

  it("resets the mode and editor drafts when the route's search changes", () => {
    const effect = DETAIL_SOURCE.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[searchId\]\);/)?.[0] ?? "";
    expect(effect).toContain('setFormatActionMode("none")');
    expect(effect).toContain('setFormatSourceUrl("")');
    expect(effect).toContain('setManualEmailDomain("")');
    expect(effect).toContain("setSelection(createEmptyProspectSelection())");
  });

  it("loading blocks duplicate submissions and conflicting modes", () => {
    // Every correction handler re-entry-guards on the shared in-flight flag.
    expect(DETAIL_SOURCE.split("if (refreshingFormat) {").length - 1).toBeGreaterThanOrEqual(4);
    // All three mode buttons disable while a correction runs.
    expect(DETAIL_SOURCE.split("disabled={refreshingFormat}").length - 1).toBeGreaterThanOrEqual(3);
    // Clear loading labels.
    expect(DETAIL_SOURCE).toContain('"Parsing…"');
    expect(DETAIL_SOURCE).toContain('"Applying…"');
    expect(DETAIL_SOURCE).toContain('"Refreshing…"');
  });

  it("success returns to none; failure keeps the relevant editor open without appending", () => {
    // Source/manual success paths close the editor.
    expect(DETAIL_SOURCE).toMatch(/setFormatActionMode\("none"\);\s*\n\s*setFormatSourceUrl\(""\);/);
    // Failure paths set an in-app error (no native alerts) and return early.
    expect(DETAIL_SOURCE).not.toContain("window.alert(");
    expect(DETAIL_SOURCE).not.toContain("window.confirm(");
    expect(DETAIL_SOURCE).toContain("Could not refresh the email format.");
    expect(DETAIL_SOURCE).toContain("Could not apply the manual email format.");
  });

  it("still calls the existing backend mutations for each action", () => {
    expect(DETAIL_SOURCE).toContain("REFRESH_COMPANY_EMAIL_FORMAT_MUTATION");
    expect(DETAIL_SOURCE).toContain("DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION");
    expect(DETAIL_SOURCE).toContain("SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION");
  });
});

// ---------------------------------------------------------------------------
// Layout — consolidation, responsiveness, and theme discipline.
// ---------------------------------------------------------------------------

describe("redesigned detail layout contracts", () => {
  it("does not repeat the summary information across several large cards", () => {
    // The four duplicate top cards (company / people / email format / status)
    // are gone with their tour markers.
    for (const removed of ["company-summary", "people-summary", "email-format-summary", "summaryGrid", "summaryCard"]) {
      expect(DETAIL_SOURCE).not.toContain(removed);
    }
    // The status target lives on the non-ready status card only.
    expect(DETAIL_SOURCE.split('data-discover-tour="status-summary"').length - 1).toBe(1);
  });

  it("renders the quality summary and email-format panel exactly once each", () => {
    expect(DETAIL_SOURCE.split('data-discover-tour="quality-summary"').length - 1).toBe(2); // card + its skeleton
    expect(DETAIL_SOURCE.split('data-discover-tour="company-details"').length - 1).toBe(1);
  });

  it("keeps the summary grids reflowable (no fixed four-across row)", () => {
    expect(CSS).toMatch(/\.qualityStats\s*\{[^}]*repeat\(auto-fit,\s*minmax\(/s);
    expect(CSS).toMatch(/\.companyMetaGrid\s*\{[^}]*repeat\(auto-fit,\s*minmax\(/s);
  });

  it("introduces no oversized landing-page typography", () => {
    // Page heading keeps the existing dashboard size; card headings stay compact.
    expect(CSS).toMatch(/\.detailHeaderTitle\s*\{[^}]*font-size:\s*1\.7rem/s);
    expect(CSS).toMatch(/\.panelTitle\s*\{[^}]*font-size:\s*1\.12rem/s);
    // The new quality styles never exceed the existing metric size.
    const qualityBlocks = CSS.match(/\.quality[A-Za-z]+\s*\{[^}]*\}/gs) ?? [];
    for (const block of qualityBlocks) {
      const size = block.match(/font-size:\s*([\d.]+)rem/);
      if (size) {
        expect(Number.parseFloat(size[1])).toBeLessThanOrEqual(1.35);
      }
    }
  });

  it("uses theme tokens (dark + light) for the new visual system", () => {
    for (const cls of [".qualityHeadline", ".qualityStat", ".editorPanel", ".inferredTag", ".dangerGhostButton"]) {
      const block = CSS.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
      expect(block).toContain("var(--");
    }
  });

  it("distinguishes suppressed from invalid by pattern, not hue alone", () => {
    expect(CSS).toMatch(/\.qualityToneSuppressed\s*\{[^}]*repeating-linear-gradient/s);
  });

  it("respects prefers-reduced-motion for the new animations", () => {
    const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(reduced).toContain(".qualityBarTrack");
    expect(reduced).toContain(".editorPanel");
    expect(reduced).toContain("animation: none");
  });

  it("adds no page-level horizontal overflow rules", () => {
    const editorShell = CSS.match(/\.editorShell\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(editorShell).not.toMatch(/overflow-x|min-width:\s*[1-9]/);
    const qualityCard = CSS.match(/\.qualityCard\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(qualityCard).not.toMatch(/overflow-x|min-width:\s*[1-9]/);
  });

  it("keeps Delete available but visually secondary in the header", () => {
    expect(DETAIL_SOURCE).toContain("styles.dangerGhostButton");
    expect(DETAIL_SOURCE).toContain('data-discover-tour="delete-search"');
    // Quiet at rest: transparent until hover/focus shows destructive intent.
    expect(CSS).toMatch(/\.dangerGhostButton\s*\{[^}]*background:\s*transparent/s);
  });
});

// ---------------------------------------------------------------------------
// Regression — existing behavior the redesign must not break.
// ---------------------------------------------------------------------------

describe("redesign regression contracts", () => {
  it("keeps Add More, export, Imports, selection, pagination, and delete wiring", () => {
    for (const kept of [
      "ADD_MORE_DISCOVER_PEOPLE_MUTATION",
      "PREPARE_PROSPECT_EXPORT_MUTATION",
      "CREATE_PROSPECT_IMPORT_MUTATION",
      "REVIEW_PROSPECT_SELECTION_MUTATION",
      "DELETE_COMPANY_MUTATION",
      "handlePeopleNext",
      "handlePeoplePrev",
      "BulkSelectionToolbar",
      "SelectAllMatchingBanner"
    ]) {
      expect(DETAIL_SOURCE).toContain(kept);
    }
  });

  it("keeps the inferred-email notice and role filters", () => {
    expect(DETAIL_SOURCE).toContain("INFERRED_EMAIL_NOTICE");
    expect(DETAIL_SOURCE).toContain('data-discover-tour="role-filters"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="inferred-warning"');
  });

  it("reads the quality data from the company detail payload (no fabricated analytics)", () => {
    expect(DETAIL_SOURCE).toContain("deriveDiscoverQualitySummary(company.emailStatusCounts)");
    expect(DETAIL_SOURCE).toContain("buildQualitySegments(company.emailStatusCounts)");
  });

  it("selects emailStatusCounts in the detail query and every format mutation payload", () => {
    // 1 type declaration + 4 GraphQL documents (detail query + 3 corrections),
    // so the summary refreshes after every correction without extra requests.
    expect(CLIENT_GRAPHQL.split("emailStatusCounts").length - 1).toBe(5);
    expect(CLIENT_GRAPHQL).toMatch(/emailStatusCounts \{\s*status\s*count\s*\}/);
  });
});
