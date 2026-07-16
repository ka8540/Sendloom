import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PAGE = readFileSync("src/app/(app)/imports/page.tsx", "utf8");
const LIBRARY = readFileSync("src/components/mapping-library.tsx", "utf8");
const WORKFLOW = readFileSync("src/components/imports-workflow.tsx", "utf8");
const WORKFLOW_STYLES = readFileSync("src/components/imports-workflow.module.css", "utf8");
const FORMS = readFileSync("src/components/forms.tsx", "utf8");

describe("Imports dashboard redesign", () => {
  it("uses one workflow card and keeps the people-list surface", () => {
    expect(PAGE).toContain('className="imports-dashboard"');
    expect(PAGE).toContain("<ImportsWorkflow");
    expect(PAGE).toContain('className="card imports-library-shell"');
    expect(PAGE).not.toContain("imports-setup-grid");
    expect(PAGE).not.toContain("imports-setup-card");
  });

  it("presents Upload, Map fields, and Review as a real three-step flow", () => {
    expect(WORKFLOW).toContain('const WORKFLOW_STEPS = ["Upload", "Map fields", "Review"]');
    expect(WORKFLOW).toContain('aria-label="Import workflow progress"');
    expect(WORKFLOW).toContain('view={activeStep === 2 ? "review" : "map"}');
    expect(WORKFLOW_STYLES).toMatch(/\.workflowCard\s*\{[^}]*border-radius: 26px;/s);
    expect(WORKFLOW_STYLES).toMatch(/\.stepNav ol\s*\{[^}]*grid-template-columns: repeat\(3,/s);
  });

  it("wraps the native file control in a polished dropzone without changing the upload endpoint", () => {
    expect(FORMS).toContain('className={importStyles.fileInput}');
    expect(FORMS).toContain('accept=".csv,.xls,.xlsx"');
    expect(FORMS).toContain('fetch("/api/imports"');
    expect(FORMS).toContain("Choose CSV or XLSX file");
    expect(FORMS).toContain("CSV, XLSX supported");
    expect(WORKFLOW_STYLES).toMatch(/\.fileInput\s*\{[^}]*position: absolute;[^}]*width: 1px;/s);
  });

  it("uses readable field cards with separate human labels and field keys", () => {
    expect(LIBRARY).toContain("formatColumnHumanLabel(column)");
    expect(LIBRARY).toContain("{column.normalized}");
    expect(LIBRARY).toContain("workflowStyles.fieldCardCopy");
    expect(WORKFLOW_STYLES).toMatch(/\.fieldCardCopy strong\s*\{[^}]*font-size: 0\.9rem;/s);
    expect(WORKFLOW_STYLES).toMatch(/\.fieldCardCopy span\s*\{[^}]*font-size: 0\.74rem;/s);
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
