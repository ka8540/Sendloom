import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PAGE = readFileSync("src/app/(app)/imports/page.tsx", "utf8");
const LIBRARY = readFileSync("src/components/mapping-library.tsx", "utf8");
const STYLES = readFileSync("src/app/globals.css", "utf8");

describe("Imports dashboard redesign", () => {
  it("uses compact setup and people-list surfaces", () => {
    expect(PAGE).toContain('className="imports-dashboard"');
    expect(PAGE).toContain('className="imports-setup-grid"');
    expect(PAGE).toContain('className="card imports-library-shell"');
  });

  it("keeps both desktop setup cards equal-height with bottom-aligned actions", () => {
    expect(STYLES).toMatch(/\.imports-setup-grid\s*\{[^}]*align-items: stretch;/s);
    expect(STYLES).toMatch(/\.imports-setup-card\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*height: 100%;/s);
    expect(STYLES).toMatch(/\.import-upload-form,\s*\.imports-field-picker\s*\{[^}]*flex: 1 1 auto;/s);
    expect(STYLES).toMatch(/\.import-upload-form > \.button,\s*\.imports-field-picker > \.button\s*\{[^}]*margin-top: auto;/s);
    expect(STYLES).toMatch(/@media \(max-width: 960px\)[\s\S]*\.imports-setup-card\s*\{[^}]*height: auto;/);
  });

  it("keeps sample contacts collapsed until their real toggle is used", () => {
    expect(LIBRARY).toContain('useState<string[]>([])');
    expect(LIBRARY).toContain('aria-expanded={showPreview}');
    expect(LIBRARY).toContain('onClick={() => toggleExpanded(setExpandedPreviewIds, item.importId)}');
    expect(LIBRARY).toContain('{isExpanded ? (');
    expect(LIBRARY).toContain('item.previewRows.slice(0, 3)');
    expect(LIBRARY).not.toContain("A quick peek at the people in this import.");
  });

  it("limits active chips and reveals other detected columns on demand", () => {
    expect(LIBRARY).toContain('selectedColumns.slice(0, 5)');
    expect(LIBRARY).toContain("data-field-tooltip");
    expect(LIBRARY).toContain('aria-expanded={showDetectedColumns}');
    expect(LIBRARY).toContain('onClick={() => toggleExpanded(setExpandedColumnIds, item.importId)}');
  });

  it("searches only the import data already loaded in the browser", () => {
    expect(LIBRARY).toContain("item.fileName");
    expect(LIBRARY).toContain("column.sourceName");
    expect(LIBRARY).toContain("column.normalized");
    expect(LIBRARY).toContain("row.primary");
    expect(LIBRARY).toContain("row.secondary");
    expect(LIBRARY).toContain("No matching imports");
    expect(LIBRARY).not.toContain("/api/imports/search");
  });

  it("preserves edit, delete, and pagination controls", () => {
    expect(LIBRARY).toContain('<PencilLine aria-hidden="true" />');
    expect(LIBRARY).toContain('<Trash2 aria-hidden="true" />');
    expect(LIBRARY).toContain('method: "DELETE"');
    expect(LIBRARY).toContain('aria-label="Previous imports page"');
    expect(LIBRARY).toContain('aria-label="Next imports page"');
  });

  it("reuses the Sequence action rail for import edit and delete controls", () => {
    expect(LIBRARY).toContain('import actionStyles from "@/components/campaign-card-actions.module.css";');
    expect(LIBRARY).toContain("<div className={actionStyles.rail}>");
    expect(LIBRARY).toContain('className={`${actionStyles.action} ${actionStyles.open}`}');
    expect(LIBRARY).toContain('className={`${actionStyles.action} ${actionStyles.delete}`}');
    expect(LIBRARY).not.toContain('className="import-card__actions"');
  });
});
