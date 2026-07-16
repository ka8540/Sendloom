import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DELETE_IMPORT_SUCCESS_MESSAGE,
  IMPORT_PICKER_EMPTY_HINT,
  IMPORT_PICKER_EMPTY_TITLE,
  IMPORT_PICKER_LABEL,
  IMPORT_PICKER_PLACEHOLDER,
  deleteImportLabel,
  importPickerRowMeta
} from "@/components/imports-editor";

// TemplateFieldPicker is a "use client" component in a node test env (no DOM),
// so behavior is verified through the pure helpers plus source/CSS assertions —
// the same style the rest of the suite uses for client components.
const LIBRARY = readFileSync("src/components/mapping-library.tsx", "utf8");
const PICKER_CSS = readFileSync("src/components/import-picker.module.css", "utf8");
const PAGE = readFileSync("src/app/(app)/imports/page.tsx", "utf8");
const WORKFLOW = readFileSync("src/components/imports-workflow.tsx", "utf8");
const WORKSPACE = readFileSync("src/components/imports-workspace.tsx", "utf8");

function templateFieldPickerBlock(): string {
  const start = LIBRARY.indexOf("export function TemplateFieldPicker");
  return LIBRARY.slice(start, LIBRARY.indexOf("export function MappingLibrary", start));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("Import picker copy helpers", () => {
  it("labels each trash action with the specific import name", () => {
    expect(deleteImportLabel("sendloom-verkada-inc-recruiting-2026-07-12.xlsx")).toBe(
      "Delete import sendloom-verkada-inc-recruiting-2026-07-12.xlsx"
    );
  });

  it("builds row metadata with correct singular/plural forms", () => {
    expect(importPickerRowMeta({ rowCount: 1, columnCount: 1 })).toBe("1 contact · 1 column");
    expect(importPickerRowMeta({ rowCount: 12, columnCount: 6 })).toBe("12 contacts · 6 columns");
  });

  it("omits the contact count when it is not available", () => {
    expect(importPickerRowMeta({ columnCount: 4 })).toBe("4 columns");
  });

  it("uses safe, non-technical copy for toast and empty state", () => {
    expect(DELETE_IMPORT_SUCCESS_MESSAGE).toBe("Import deleted.");
    expect(IMPORT_PICKER_EMPTY_TITLE).toBe("No imports available");
    expect(IMPORT_PICKER_EMPTY_HINT).toBe("Review or add an import first.");
    expect(IMPORT_PICKER_PLACEHOLDER).toBe("Select an import");
    expect(IMPORT_PICKER_LABEL).toBe("Select import");
  });
});

// ---------------------------------------------------------------------------
// The custom picker replaces the native select
// ---------------------------------------------------------------------------

describe("Template fields uses a custom picker instead of the native select", () => {
  const picker = templateFieldPickerBlock();

  it("renders no native <select> anywhere in the picker", () => {
    expect(picker).not.toContain("<select");
    expect(picker).not.toContain("<option");
  });

  it("the trigger is an accessible disclosure named 'Select import'", () => {
    expect(picker).toContain('aria-haspopup="listbox"');
    expect(picker).toContain("aria-expanded={pickerOpen}");
    expect(picker).toContain("aria-label={IMPORT_PICKER_LABEL}");
    expect(picker).toContain("IMPORT_PICKER_PLACEHOLDER");
  });

  it("keeps the guided-tour anchor on the picker field", () => {
    expect(picker).toContain('data-imports-tour="pending-selector"');
  });

  it("rows render the filename, metadata, and a per-import trash action", () => {
    expect(picker).toContain("importPickerRowMeta(");
    expect(picker).toContain("aria-label={deleteImportLabel(entry.fileName)}");
    expect(picker).toContain('<Trash2 aria-hidden="true" />');
  });

  it("the trash is a sibling button of the row's select action, so it never selects", () => {
    // Selecting happens only in the option button; the delete button only
    // stages the confirmation.
    expect(picker).toContain("onClick={() => chooseImport(entry.importId)}");
    expect(picker).toMatch(/deletion\.requestDeletion\(\{\s*importId: entry\.importId/);
    const deleteButton = picker.slice(picker.indexOf("deletion.requestDeletion"), picker.indexOf("</li>"));
    expect(deleteButton).not.toContain("chooseImport");
    expect(deleteButton).not.toContain("setSelectedImportId");
  });

  it("supports keyboard use: Escape closes, arrows move between options", () => {
    expect(picker).toContain('event.key === "Escape"');
    expect(picker).toContain('event.key === "ArrowDown"');
    expect(picker).toContain('event.key === "ArrowUp"');
    expect(picker).toContain("triggerRef.current?.focus()");
  });

  it("shows the clean empty state when no imports are available", () => {
    expect(picker).toContain("IMPORT_PICKER_EMPTY_TITLE");
    expect(picker).toContain("IMPORT_PICKER_EMPTY_HINT");
    expect(picker).toMatch(/visibleImports\.length === 0 \?/);
  });

  it("keeps Save disabled unless an import is selected (existing save flow intact)", () => {
    expect(picker).toContain("disabled={state.pending || selectedColumns.length === 0}");
    expect(picker).toContain("/template-fields");
    expect(picker).toContain('data-imports-tour="save-template-fields"');
  });
});

// ---------------------------------------------------------------------------
// Deletion is the one shared flow, wired into the picker
// ---------------------------------------------------------------------------

describe("Picker deletion reuses the single shared import-deletion flow", () => {
  const picker = templateFieldPickerBlock();

  it("there is exactly one DELETE /api/imports call in the whole file", () => {
    const matches = LIBRARY.match(/method: "DELETE"/g) ?? [];
    expect(matches).toHaveLength(1);
    const fetches =
      LIBRARY.match(/fetch\(`\/api\/imports\/\$\{item\.importId\}`, \{\s*method: "DELETE"/g) ?? [];
    expect(fetches).toHaveLength(1);
  });

  it("both the picker and the imports list render the same shared dialog", () => {
    const dialogs = LIBRARY.match(/<ImportDeleteDialog deletion=\{deletion\} \/>/g) ?? [];
    expect(dialogs).toHaveLength(2);
    expect(picker).toContain("<ImportDeleteDialog");
  });

  it("the shared flow confirms first, deletes once, refreshes, and toasts success", () => {
    // Trash only stages the pending deletion — the mutation runs on confirm.
    expect(LIBRARY).toContain("setPendingDeletion(item)");
    expect(LIBRARY).toMatch(/confirmDeleteImport\(\)[\s\S]{0,260}if \(!item \|\| deletingImportId\)/);
    expect(LIBRARY).toContain("router.refresh()");
    expect(LIBRARY).toContain("showSuccess(DELETE_IMPORT_SUCCESS_MESSAGE)");
  });

  it("cancel keeps the import: it only clears the staged deletion, never fetches", () => {
    const cancel = LIBRARY.slice(
      LIBRARY.indexOf("function cancelDeletion"),
      LIBRARY.indexOf("async function confirmDeleteImport")
    );
    expect(cancel).not.toContain("fetch");
    expect(cancel).toContain("setPendingDeletion(null)");
  });

  it("a failed delete keeps the import and shows only the safe message", () => {
    expect(LIBRARY).toContain("setDeleteError(DELETE_IMPORT_ERROR_MESSAGE)");
  });

  it("a deleted import disappears immediately and a deleted selection is cleared", () => {
    expect(picker).toContain("setRemovedImportIds((current) => [...current, importId])");
    expect(picker).toContain('setSelectedImportId((current) => (current === importId ? "" : current))');
    expect(picker).toMatch(/visibleImports = useMemo\([\s\S]{0,160}!removedImportIds\.includes\(entry\.importId\)/);
  });
});

// ---------------------------------------------------------------------------
// Styling + data plumbing
// ---------------------------------------------------------------------------

describe("Picker styling is premium, theme-aware, and truncation-safe", () => {
  it("long filenames truncate cleanly in the trigger and rows", () => {
    expect(PICKER_CSS).toMatch(/\.triggerText \{[\s\S]*?text-overflow: ellipsis/);
    expect(PICKER_CSS).toMatch(/\.rowNameText \{[\s\S]*?text-overflow: ellipsis/);
  });

  it("uses theme variables (light/dark) with the green accent for focus", () => {
    expect(PICKER_CSS).toContain("var(--accent");
    expect(PICKER_CSS).toContain("var(--surface");
    expect(PICKER_CSS).toMatch(/\.trigger:focus-visible \{[\s\S]*?var\(--accent\)/);
  });

  it("the open panel scrolls past a max height instead of growing unbounded", () => {
    expect(PICKER_CSS).toMatch(/\.list \{[\s\S]*?max-height:[\s\S]*?overflow-y: auto/);
  });

  it("the trash stays reachable on touch devices and has a visible focus ring", () => {
    expect(PICKER_CSS).toMatch(/@media \(hover: none\) \{[\s\S]*?\.rowDelete \{[\s\S]*?opacity: 1/);
    expect(PICKER_CSS).toMatch(/\.rowDelete:focus-visible \{[\s\S]*?box-shadow/);
  });

  it("the Imports page feeds the picker its metadata for rows and delete copy", () => {
    expect(PAGE).toContain("rowCount: entry.rowCount");
    expect(PAGE).toContain("linkedCampaignCount: entry._count.campaigns");
    expect(PAGE).toContain("<ImportsWorkspace");
    expect(WORKSPACE).toContain("<ImportsWorkflow");
    expect(WORKFLOW).toContain("<TemplateFieldPicker");
  });

  it("feeds all owned imports to the workflow and resolves the initial selection separately", () => {
    expect(PAGE).toContain("const workflowItems = imports.map");
    expect(PAGE).toContain("needsFieldSelection: importNeedsFieldSelection");
    expect(PAGE).toContain("resolveInitialImportId(workflowItems, requestedImportId)");
    expect(PAGE).toContain("workflowItems={workflowItems}");
    expect(WORKSPACE).toContain("imports={workflowItems}");
  });
});
