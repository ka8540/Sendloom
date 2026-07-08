import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Source-level guarantees for the sequence detail metric cards. The page is a
// server component (not renderable in the node test environment), so these
// follow the repo's node-only source-assertion convention: the cards must be
// wired to the shared per-recipient disposition classification so invalid
// recipient bounces can never inflate Delivered or vanish from the summary.

const DETAIL_PAGE = readFileSync("src/app/(app)/campaigns/[id]/page.tsx", "utf8");

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

  it("shows the skipped/invalid count on the summary cards", () => {
    // The fourth card surfaces Skipped / invalid whenever there are no real
    // failures, and the audience card always carries the skipped sublabel.
    expect(DETAIL_PAGE).toContain("Skipped / invalid");
    expect(DETAIL_PAGE).toContain("Invalid or excluded recipients");
    expect(DETAIL_PAGE).toMatch(/skippedCount > 0 \? ` · \$\{skippedCount\} skipped/);
  });

  it("keeps Needs attention for real failures only (disposition-based, shown when present)", () => {
    expect(DETAIL_PAGE).toContain("const issueCount = dispositionCounts.needsAttention");
    expect(DETAIL_PAGE).toMatch(/issueCount > 0 \? \(/);
    expect(DETAIL_PAGE).toContain("Failed sends &amp; retries");
  });
});
