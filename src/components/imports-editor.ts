/**
 * Pure logic + copy for the unified import editor (the pencil action on a
 * processed Import card). Kept DOM-free so it can be unit-tested in the node
 * test environment, and shared by the dialog in `mapping-library.tsx`.
 *
 * The editor coordinates the two existing, independent backend operations —
 * rename (`PATCH /api/imports/:id`) and template-field selection
 * (`POST /api/imports/:id/template-fields`) — behind one Save action. No new
 * import is created and no backend behavior changes: deselecting a column only
 * removes it from the active template variables, never the stored import data.
 */

/** Safe, user-facing message for a failed import deletion (never backend detail). */
export const DELETE_IMPORT_ERROR_MESSAGE = "This import could not be deleted. Please try again.";
/** Success toast shown after an import is deleted (from the list or the picker). */
export const DELETE_IMPORT_SUCCESS_MESSAGE = "Import deleted.";

// Copy for the Template fields import picker, centralized like the editor copy.
export const IMPORT_PICKER_LABEL = "Select import";
export const IMPORT_PICKER_PLACEHOLDER = "Select an import";
export const IMPORT_PICKER_EMPTY_TITLE = "No imports available";
export const IMPORT_PICKER_EMPTY_HINT = "Review or add an import first.";

/** Accessible label for a picker row's trash action, e.g. "Delete import AMD SDE". */
export function deleteImportLabel(fileName: string): string {
  return `Delete import ${fileName}`;
}

/** Compact metadata line for a picker row, e.g. "12 contacts · 6 columns". */
export function importPickerRowMeta(entry: { rowCount?: number; columnCount: number }): string {
  const parts: string[] = [];
  if (typeof entry.rowCount === "number") {
    parts.push(`${entry.rowCount} ${entry.rowCount === 1 ? "contact" : "contacts"}`);
  }
  parts.push(`${entry.columnCount} ${entry.columnCount === 1 ? "column" : "columns"}`);
  return parts.join(" · ");
}

/**
 * Plain-language warning shown in the import delete confirmation, with correct
 * singular/plural for any linked sequences. Pure so the wording is unit-testable.
 */
export function describeImportDeletion(item: { fileName: string; linkedCampaignCount: number }): string {
  if (item.linkedCampaignCount > 0) {
    const count = item.linkedCampaignCount;
    return `Deleting “${item.fileName}” will also delete ${count} linked sequence${count === 1 ? "" : "s"}. This action cannot be undone.`;
  }
  return `Deleting “${item.fileName}” will permanently remove this imported audience. This action cannot be undone.`;
}

export const MAX_TEMPLATE_COLUMNS = 10;
/** Mirrors the rename API/input cap (`z.string().max(120)`). */
export const IMPORT_NAME_MAX_LENGTH = 120;

// User-facing copy. Centralized so the dialog and its tests stay in lockstep.
export const EDIT_IMPORT_TITLE = "Edit import";
export const EDIT_IMPORT_NAME_LABEL = "Import name";
export const EDIT_IMPORT_FIELDS_LABEL = "Active template fields";
export const EDIT_IMPORT_FIELDS_HINT = "Select the columns that can be used as template variables. Columns you leave unchecked stay stored with the import as other detected columns and can be activated again here later.";
export const EDIT_IMPORT_SAVE_LABEL = "Save changes";
export const EDIT_IMPORT_SAVING_LABEL = "Saving…";
export const EDIT_IMPORT_CANCEL_LABEL = "Cancel";
export const EDIT_IMPORT_SUCCESS_MESSAGE = "Import updated.";
/** Safe, non-technical failure copy — never surfaces backend/Prisma/GraphQL detail. */
export const EDIT_IMPORT_ERROR_MESSAGE = "The import changes could not be saved. Please try again.";
export const EDIT_IMPORT_EMPTY_NAME_MESSAGE = "Import name cannot be empty.";
export const EDIT_IMPORT_NO_FIELDS_MESSAGE = "Choose at least one template field before saving.";

export type ImportEditState = {
  name: string;
  selectedColumns: string[];
};

/** Trim leading/trailing whitespace exactly like the rename API (`z.string().trim()`). */
export function normalizeImportName(value: string): string {
  return value.trim();
}

export type NameValidation = { ok: true; value: string } | { ok: false; error: string };

/** Validate the edited name: reject empty, trim, and apply the existing max length. */
export function validateImportName(value: string): NameValidation {
  const trimmed = normalizeImportName(value);
  if (!trimmed) {
    return { ok: false, error: EDIT_IMPORT_EMPTY_NAME_MESSAGE };
  }
  return { ok: true, value: trimmed.slice(0, IMPORT_NAME_MAX_LENGTH) };
}

/**
 * Toggle a column in/out of the active template-field selection, respecting the
 * max cap. Deselecting only removes it from the active set — the column remains
 * detected/stored on the import. Mirrors the existing picker toggle.
 */
export function toggleTemplateColumn(selected: string[], column: string, max = MAX_TEMPLATE_COLUMNS): string[] {
  if (selected.includes(column)) {
    return selected.filter((entry) => entry !== column);
  }
  if (selected.length >= max) {
    return selected;
  }
  return [...selected, column];
}

/** Order-insensitive comparison of two active-field selections. */
export function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((entry) => setB.has(entry));
}

export type ImportEditDiff = { nameChanged: boolean; fieldsChanged: boolean };

/** Which parts of the import the user actually edited (name compared after trim). */
export function diffImportEdit(original: ImportEditState, draft: ImportEditState): ImportEditDiff {
  return {
    nameChanged: normalizeImportName(draft.name) !== normalizeImportName(original.name),
    fieldsChanged: !sameSelection(draft.selectedColumns, original.selectedColumns)
  };
}

export type ImportEditPlan =
  | { kind: "noop" }
  | { kind: "invalid"; error: string }
  | { kind: "apply"; nameChanged: boolean; fieldsChanged: boolean; name: string; selectedColumns: string[] };

/**
 * Build the save plan from the original import and the editor draft. The plan
 * only marks the operations that are actually needed, so a name-only change
 * never runs a field update (and vice versa). Validation runs only for the
 * parts being changed so an unedited card is never blocked.
 */
export function planImportEdit(original: ImportEditState, draft: ImportEditState): ImportEditPlan {
  const { nameChanged, fieldsChanged } = diffImportEdit(original, draft);

  if (!nameChanged && !fieldsChanged) {
    return { kind: "noop" };
  }

  if (nameChanged) {
    const validation = validateImportName(draft.name);
    if (!validation.ok) {
      return { kind: "invalid", error: validation.error };
    }
  }

  if (fieldsChanged && draft.selectedColumns.length === 0) {
    return { kind: "invalid", error: EDIT_IMPORT_NO_FIELDS_MESSAGE };
  }

  return {
    kind: "apply",
    nameChanged,
    fieldsChanged,
    name: normalizeImportName(draft.name),
    selectedColumns: draft.selectedColumns
  };
}

/** Accessible label for a specific import's pencil action, e.g. "Edit AMD SDE import". */
export function editImportLabel(fileName: string): string {
  return `Edit ${fileName} import`;
}
