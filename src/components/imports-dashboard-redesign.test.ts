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

  it("uses the full dashboard width with a controlled responsive field grid", () => {
    expect(WORKFLOW_STYLES).toMatch(/\.workflowCard\s*\{[^}]*width: 100%;/s);
    expect(WORKFLOW_STYLES).not.toContain("width: min(100%, 64rem)");
    expect(WORKFLOW_STYLES).toMatch(/\.fieldGrid\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/s);
    expect(WORKFLOW_STYLES).toMatch(/@media \(max-width: 900px\)[\s\S]*\.fieldGrid\s*\{[^}]*repeat\(2,/s);
    expect(WORKFLOW_STYLES).toMatch(/@media \(max-width: 560px\)[\s\S]*\.fieldGrid\s*\{[^}]*grid-template-columns: 1fr;/s);
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

  it("keeps the exact active import visible beside its selected-field count", () => {
    expect(LIBRARY).toContain("workflowStyles.selectionImport");
    expect(LIBRARY).toContain("Selected import");
    expect(LIBRARY).toContain("{selectedImport.fileName}");
    expect(LIBRARY).toContain("workflowStyles.selectionCount");
  });

  it("moves a direct upload into mapping with the exact returned import id", () => {
    expect(FORMS).toContain("onUploaded?.(payload.id)");
    expect(WORKFLOW).toContain("setPreferredImportId(importId)");
    expect(WORKFLOW).toContain("setPreparingImport(true)");
    expect(WORKFLOW).toContain("setActiveStep(1)");
    expect(WORKFLOW).toContain("initialImportId={preferredImportId}");
  });

  it("reapplies route import context when the mounted workflow receives a new id", () => {
    expect(WORKFLOW).toMatch(/useEffect\(\(\) => \{[\s\S]*setPreferredImportId\(initialImportId\);[\s\S]*setActiveStep\(1\);[\s\S]*\}, \[initialImportId\]\);/);
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
