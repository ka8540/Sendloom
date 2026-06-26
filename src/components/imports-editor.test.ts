import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EDIT_IMPORT_EMPTY_NAME_MESSAGE,
  EDIT_IMPORT_ERROR_MESSAGE,
  EDIT_IMPORT_NO_FIELDS_MESSAGE,
  EDIT_IMPORT_SUCCESS_MESSAGE,
  IMPORT_NAME_MAX_LENGTH,
  MAX_TEMPLATE_COLUMNS,
  diffImportEdit,
  editImportLabel,
  planImportEdit,
  sameSelection,
  toggleTemplateColumn,
  validateImportName
} from "@/components/imports-editor";

// The dialog is a "use client" component in a node test env (no DOM), so its
// wiring is verified through source assertions while the save logic lives in the
// pure helpers above. This mirrors the existing prospect-view / overlay-card
// test style and keeps the editor backend-free (no external calls).
const SOURCE = readFileSync("src/components/mapping-library.tsx", "utf8");

const original = { name: "AMD SDE", selectedColumns: ["first_name", "last_name", "email", "job_title"] };

// --------------------------------------------------------------------------
// Pure save logic
// --------------------------------------------------------------------------

describe("import name validation (#7, #19)", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(validateImportName("")).toEqual({ ok: false, error: EDIT_IMPORT_EMPTY_NAME_MESSAGE });
    expect(validateImportName("   ")).toEqual({ ok: false, error: EDIT_IMPORT_EMPTY_NAME_MESSAGE });
  });

  it("trims surrounding whitespace before saving", () => {
    expect(validateImportName("  AMD SDE  ")).toEqual({ ok: true, value: "AMD SDE" });
  });

  it("applies the existing 120-char max length", () => {
    expect(IMPORT_NAME_MAX_LENGTH).toBe(120);
    const result = validateImportName("x".repeat(IMPORT_NAME_MAX_LENGTH + 50));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(IMPORT_NAME_MAX_LENGTH);
    }
  });
});

describe("template field toggling keeps detected data intact (#8, #9)", () => {
  it("activates another detected field without dropping the others (#8)", () => {
    expect(toggleTemplateColumn(["email"], "company")).toEqual(["email", "company"]);
  });

  it("deactivates an active field — only removing it from the active set (#9)", () => {
    expect(toggleTemplateColumn(["email", "company"], "email")).toEqual(["company"]);
  });

  it("never activates more than the max columns, but can always deselect at the cap", () => {
    const full = Array.from({ length: MAX_TEMPLATE_COLUMNS }, (_, index) => `c${index}`);
    expect(toggleTemplateColumn(full, "extra")).toEqual(full);
    expect(toggleTemplateColumn(full, "c0")).toHaveLength(MAX_TEMPLATE_COLUMNS - 1);
  });

  it("compares selections order-insensitively", () => {
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSelection(["a"], ["a", "b"])).toBe(false);
  });
});

describe("the save plan only runs the parts that changed (#11, #16, #17, #18)", () => {
  it("is a no-op when nothing changed, even if fields are reordered", () => {
    expect(
      diffImportEdit(original, { name: " AMD SDE ", selectedColumns: ["email", "job_title", "first_name", "last_name"] })
    ).toEqual({ nameChanged: false, fieldsChanged: false });
    expect(planImportEdit(original, { name: "AMD SDE", selectedColumns: [...original.selectedColumns] })).toEqual({
      kind: "noop"
    });
  });

  it("name-only change → rename only (#16)", () => {
    const plan = planImportEdit(original, { name: "AMD Engineers", selectedColumns: [...original.selectedColumns] });
    expect(plan).toEqual({
      kind: "apply",
      nameChanged: true,
      fieldsChanged: false,
      name: "AMD Engineers",
      selectedColumns: original.selectedColumns
    });
  });

  it("fields-only change → field update only (#17)", () => {
    const plan = planImportEdit(original, { name: "AMD SDE", selectedColumns: ["first_name", "last_name", "email"] });
    expect(plan).toMatchObject({ kind: "apply", nameChanged: false, fieldsChanged: true });
  });

  it("combined change → both, with a trimmed name (#18)", () => {
    const plan = planImportEdit(original, { name: "  AMD Eng  ", selectedColumns: ["email"] });
    expect(plan).toMatchObject({ kind: "apply", nameChanged: true, fieldsChanged: true, name: "AMD Eng" });
  });

  it("rejects an emptied name (#19)", () => {
    expect(planImportEdit(original, { name: "   ", selectedColumns: [...original.selectedColumns] })).toEqual({
      kind: "invalid",
      error: EDIT_IMPORT_EMPTY_NAME_MESSAGE
    });
  });

  it("rejects clearing every template field (existing required-field rule)", () => {
    expect(planImportEdit(original, { name: "AMD SDE", selectedColumns: [] })).toEqual({
      kind: "invalid",
      error: EDIT_IMPORT_NO_FIELDS_MESSAGE
    });
  });
});

describe("accessible pencil label is import-specific (#22)", () => {
  it("names the import in the label", () => {
    expect(editImportLabel("AMD SDE")).toBe("Edit AMD SDE import");
    expect(editImportLabel("PermitFLow SDE")).toBe("Edit PermitFLow SDE import");
  });
});

describe("editor copy is safe and user-facing (#20)", () => {
  it("the failure message never leaks backend / stack detail", () => {
    expect(EDIT_IMPORT_ERROR_MESSAGE).toBe("The import changes could not be saved. Please try again.");
    expect(EDIT_IMPORT_ERROR_MESSAGE).not.toMatch(/graphql|prisma|sql|stack|status|500|undefined|null/i);
    expect(EDIT_IMPORT_SUCCESS_MESSAGE).toBe("Import updated.");
  });
});

// --------------------------------------------------------------------------
// Card + dialog wiring (source assertions)
// --------------------------------------------------------------------------

describe("the processed card has ONE edit entry point — the pencil (#1, #2, #23)", () => {
  it("removes the duplicate Edit fields button and its inline editor (#1)", () => {
    // The old inline "Edit fields" toggle + its bespoke editor markup are gone.
    expect(SOURCE).not.toContain("Edit fields");
    expect(SOURCE).not.toContain("import-card__section-button");
    expect(SOURCE).not.toContain("import-card__editor");
  });

  it("keeps an icon-only pencil button with the Edit import tooltip + import-specific label (#2, #22)", () => {
    expect(SOURCE).toContain('<PencilLine aria-hidden="true" />');
    expect(SOURCE).toContain('data-tooltip="Edit import"');
    expect(SOURCE).toContain("aria-label={editImportLabel(item.fileName)}");
    // A real <button type="button"> that carries the import-specific label.
    expect(SOURCE).toMatch(/<button[\s\S]{0,600}aria-label=\{editImportLabel\(item\.fileName\)\}/);
  });

  it("keeps the trash action and its existing confirm-based delete untouched (#23)", () => {
    expect(SOURCE).toContain('<Trash2 aria-hidden="true" />');
    expect(SOURCE).toContain("window.confirm(");
    expect(SOURCE).toContain('method: "DELETE"');
  });

  it("clicking the pencil opens the one unified dialog for that import (#3)", () => {
    expect(SOURCE).toContain("setEditingImportId(item.importId)");
    expect(SOURCE).toContain("<ImportEditorDialog");
    expect(SOURCE).toContain("item={editingItem}");
  });
});

describe("the unified dialog shows the name + all fields with the active ones checked (#4, #5, #6, #10)", () => {
  it("initializes the name input from the current import name (#4)", () => {
    expect(SOURCE).toContain("useState(item.fileName)");
    expect(SOURCE).toContain("maxLength={IMPORT_NAME_MAX_LENGTH}");
    expect(SOURCE).toContain("value={draftName}");
  });

  it("lists every detected column with the active ones pre-selected (#5, #6)", () => {
    expect(SOURCE).toContain("useState<string[]>(() => [...item.selectedTemplateColumns])");
    expect(SOURCE).toMatch(/item\.columns\.map\(\(column\) => \{[\s\S]{0,160}draftColumns\.includes\(column\.normalized\)/);
  });

  it("Cancel and the close control just dismiss — no request runs (#10)", () => {
    expect(SOURCE).toContain("onClick={onClose}");
    // The dialog never uses native browser dialogs.
    const dialog = SOURCE.slice(SOURCE.indexOf("function ImportEditorDialog"));
    expect(dialog).not.toContain("window.prompt(");
    expect(dialog).not.toContain("window.confirm(");
    expect(dialog).not.toContain("window.alert(");
  });
});

describe("Save updates the same import in place and never creates one (#11–#15, #21)", () => {
  const dialog = SOURCE.slice(SOURCE.indexOf("function ImportEditorDialog"));

  it("targets the same import id on the existing rename + field endpoints (#11, #12)", () => {
    expect(dialog).toContain("`/api/imports/${item.importId}`");
    expect(dialog).toContain("`/api/imports/${item.importId}/template-fields`");
    expect(dialog).toMatch(/method: "PATCH"[\s\S]{0,140}fileName: plan\.name/);
    expect(dialog).toMatch(/template-fields`[\s\S]{0,200}selectedColumns: plan\.selectedColumns/);
  });

  it("never hits the create-import endpoint and never touches contacts or sequences (#12, #13, #14)", () => {
    // No bare POST to the upload/create route, no row/contact mutation, no
    // sequence detach — the editor reuses only rename + template-fields.
    expect(dialog).not.toMatch(/fetch\(`?\/api\/imports`?,\s*\{\s*method: "POST"/);
    expect(dialog).not.toContain("/rows");
    expect(dialog).not.toContain("campaign");
    expect(dialog).not.toContain('method: "DELETE"');
  });

  it("refreshes the card in place instead of reloading the page (#15)", () => {
    expect(dialog).toContain("router.refresh()");
    expect(dialog).not.toContain("window.location.reload");
  });

  it("guards re-entry so rapid clicks never double-submit (#21)", () => {
    expect(dialog).toMatch(/if \(saving\) \{[\s\S]{0,120}return;/);
    expect(dialog).toContain("onClick={() => void handleSave()}");
    expect(dialog).toContain("disabled={saving}");
  });
});

describe("a failed save is safe: stays open, shows safe copy, refetches (#20)", () => {
  const handler = SOURCE.slice(SOURCE.indexOf("async function handleSave"), SOURCE.indexOf("if (!mounted)"));

  it("the catch path sets the safe message + refetches and does NOT close", () => {
    // Bound the slice to the catch body (it ends just before the success toast).
    const catchBlock = handler.slice(handler.indexOf("} catch {"), handler.indexOf("showSuccess"));
    expect(catchBlock).toContain("setError(EDIT_IMPORT_ERROR_MESSAGE)");
    expect(catchBlock).toContain("router.refresh()");
    expect(catchBlock).not.toContain("onClose()");
  });

  it("only the success path (after the try/catch) toasts and closes", () => {
    expect(handler).toContain("showSuccess(EDIT_IMPORT_SUCCESS_MESSAGE)");
    expect(handler.indexOf("showSuccess(EDIT_IMPORT_SUCCESS_MESSAGE)")).toBeGreaterThan(handler.indexOf("} catch {"));
    expect(handler.lastIndexOf("onClose()")).toBeGreaterThan(handler.indexOf("} catch {"));
  });
});

describe("the dialog is a body-portal modal that cannot resize the card (#9 layout)", () => {
  it("renders through a portal to document.body with dialog semantics", () => {
    const dialog = SOURCE.slice(SOURCE.indexOf("function ImportEditorDialog"));
    expect(dialog).toContain("createPortal(");
    expect(dialog).toContain("document.body");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
  });
});
