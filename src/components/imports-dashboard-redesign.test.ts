import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PAGE = readFileSync("src/app/(app)/imports/page.tsx", "utf8");
const LIBRARY = readFileSync("src/components/mapping-library.tsx", "utf8");

describe("Imports dashboard redesign", () => {
  it("uses compact setup and people-list surfaces", () => {
    expect(PAGE).toContain('className="imports-dashboard"');
    expect(PAGE).toContain('className="imports-setup-grid"');
    expect(PAGE).toContain('className="card imports-library-shell"');
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
});
