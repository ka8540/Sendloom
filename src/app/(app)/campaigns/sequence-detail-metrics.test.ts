import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Source-level guarantees for the sequence detail metric cards. The page is a
// server component (not renderable in the node test environment), so these
// follow the repo's node-only source-assertion convention: the cards must be
// wired to the shared per-recipient disposition classification so invalid
// recipient bounces can never inflate Delivered or vanish from the summary.

const DETAIL_PAGE = readFileSync("src/app/(app)/campaigns/[id]/page.tsx", "utf8");
const DETAIL_CSS = readFileSync("src/app/(app)/campaigns/[id]/page.module.css", "utf8");
const ACTION_FILES = [
  "src/components/campaign-bounce-check-button.tsx",
  "src/components/campaign-detail-delete-button.tsx",
  "src/components/campaign-launch-button.tsx",
  "src/components/campaign-pause-resume-button.tsx",
  "src/components/campaign-retry-failed-button.tsx",
  "src/components/campaign-schedule-editor.tsx"
].map((file) => readFileSync(file, "utf8"));

describe("sequence detail metric cards — truthful recipient rollups", () => {
  it("classifies recipients with the shared overview disposition helper", () => {
    expect(DETAIL_PAGE).toContain("summarizeRecipientOverviewDispositions(dispositionJobs)");
  });

  it("derives Delivered from the disposition classification, never raw sent+opened+clicked counters", () => {
    // A hard-bounced recipient stuck in an engagement status (false pixel
    // "open") must not count as delivered.
    expect(DETAIL_PAGE).toContain("const deliveredCount = dispositionCounts.sent");
    expect(DETAIL_PAGE).not.toMatch(/sentCount\s*\?\?\s*0\)\s*\+\s*\(run\?\.openedCount/);
  });

  it("shows exactly three compact summary cards with no Replies card", () => {
    expect(DETAIL_PAGE.match(/<article className=\{styles\.metricCard\}>/g)).toHaveLength(3);
    expect(DETAIL_PAGE).toContain("Audience size");
    expect(DETAIL_PAGE).toContain("Delivered");
    expect(DETAIL_PAGE).toContain("Skipped / invalid");
    expect(DETAIL_PAGE).toContain("Invalid or excluded recipients");
    expect(DETAIL_PAGE).not.toContain('<span className={styles.metricLabel}>Replies</span>');
    expect(DETAIL_PAGE).toMatch(/skippedCount > 0 \? ` · \$\{skippedCount\} skipped`/);
  });

  it("keeps Needs attention for real failures only without replacing the skipped metric", () => {
    expect(DETAIL_PAGE).toContain("const issueCount = dispositionCounts.needsAttention");
    expect(DETAIL_PAGE).toMatch(/issueCount > 0 && !isActiveRun && !isPausedRun/);
    expect(DETAIL_PAGE).toContain('data-tone={sequenceStatusTone}');
  });

  it("uses a non-interactive run-state treatment and icon-only actions", () => {
    expect(DETAIL_PAGE).toContain("className={styles.runState}");
    expect(DETAIL_PAGE).not.toContain("className={styles.primaryAction}");
    expect(DETAIL_PAGE).toContain("iconOnly");
    expect(DETAIL_CSS).toContain(".actionBar :global(.sequence-detail-action)");
    expect(DETAIL_CSS).toContain("border-radius: 999px");
    expect(DETAIL_CSS).toContain("width: 3.15rem");
    expect(DETAIL_CSS).toContain("width: var(--detail-action-expanded-width)");
    expect(DETAIL_CSS).toContain(".sequence-detail-action:disabled");
    expect(ACTION_FILES.every((source) => source.includes("iconOnly?: boolean"))).toBe(true);
  });

  it("keeps actions accessible while using inline hover labels instead of duplicate tooltips", () => {
    expect(DETAIL_PAGE).toContain('className="sequence-detail-action__label"');
    expect(DETAIL_PAGE).toContain('campaign.lastValidatedAt ? "Refresh" : "Validate"');
    expect(DETAIL_PAGE).not.toContain("data-tooltip={validationButtonLabel}");
    for (const actionSource of ACTION_FILES) {
      const actionButton = actionSource.match(/<button[\s\S]*?data-action=[\s\S]*?<\/button>/)?.[0] ?? "";
      expect(actionSource).toContain("aria-label=");
      expect(actionSource).toContain("sequence-detail-action__label");
      expect(actionButton).not.toBe("");
      expect(actionButton).not.toContain("data-tooltip=");
      expect(actionButton).not.toContain("title=");
    }
  });

  it("uses short, non-wrapping visible labels while preserving descriptive accessible names", () => {
    expect(DETAIL_CSS).toContain("white-space: nowrap");
    expect(ACTION_FILES[0]).toContain('pending ? "Checking…" : "Bounces"');
    expect(ACTION_FILES[1]).toContain('pending ? "Deleting…" : "Delete"');
    expect(ACTION_FILES[2]).toContain('props.label === "Relaunch sequence" ? "Relaunch" : "Launch"');
    expect(ACTION_FILES[3]).toContain('props.isPaused ? "Relaunch" : "Pause"');
    expect(ACTION_FILES[4]).toContain('pending ? "Retrying…" : "Retry"');
    expect(ACTION_FILES[5]).toContain('className="sequence-detail-action__label">Edit</span>');
    expect(ACTION_FILES.join("\n")).toContain(
      'aria-label={props.iconOnly ? (pending ? "Launching sequence" : props.label) : undefined}'
    );
    expect(ACTION_FILES.join("\n")).toContain('aria-label={props.iconOnly ? "Edit sequence" : undefined}');
  });
});
