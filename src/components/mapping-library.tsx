"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, PencilLine, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CircularCloseButton } from "@/components/circular-close-button";
import editorStyles from "@/components/import-editor-dialog.module.css";
import pickerStyles from "@/components/import-picker.module.css";
import {
  DELETE_IMPORT_ERROR_MESSAGE,
  DELETE_IMPORT_SUCCESS_MESSAGE,
  EDIT_IMPORT_CANCEL_LABEL,
  EDIT_IMPORT_ERROR_MESSAGE,
  EDIT_IMPORT_FIELDS_HINT,
  EDIT_IMPORT_FIELDS_LABEL,
  EDIT_IMPORT_NAME_LABEL,
  EDIT_IMPORT_SAVE_LABEL,
  EDIT_IMPORT_SAVING_LABEL,
  EDIT_IMPORT_SUCCESS_MESSAGE,
  EDIT_IMPORT_TITLE,
  IMPORT_NAME_MAX_LENGTH,
  IMPORT_PICKER_EMPTY_HINT,
  IMPORT_PICKER_EMPTY_TITLE,
  IMPORT_PICKER_LABEL,
  IMPORT_PICKER_PLACEHOLDER,
  MAX_TEMPLATE_COLUMNS,
  deleteImportLabel,
  describeImportDeletion,
  editImportLabel,
  importPickerRowMeta,
  planImportEdit,
  toggleTemplateColumn
} from "@/components/imports-editor";

const IMPORTS_PAGE_SIZE = 5;

type MappingColumn = {
  sourceName: string;
  normalized: string;
};

type TemplateFieldItem = {
  importId: string;
  fileName: string;
  columns: MappingColumn[];
  selectedColumns: string[];
  rowCount?: number;
  linkedCampaignCount?: number;
};

type MappingLibraryItem = {
  importId: string;
  fileName: string;
  status: string;
  rowCount: number;
  linkedCampaignCount: number;
  selectedTemplateColumns: string[];
  columns: MappingColumn[];
  previewRows: Array<{
    id: string;
    primary: string;
    secondary: string;
    tertiary: string;
  }>;
  updatedAt?: string;
};

function formatColumnLabel(column: MappingColumn) {
  return column.sourceName === column.normalized
    ? column.sourceName
    : `${column.sourceName} (${column.normalized})`;
}

type DeletableImport = {
  importId: string;
  fileName: string;
  linkedCampaignCount: number;
};

/**
 * The one import-deletion flow, shared by the Template fields picker and the
 * Imports list below it. Same DELETE endpoint, same confirmation copy, same
 * safe error message, same refresh — a trash action anywhere on the page
 * behaves identically. The mutation runs only after the in-app confirmation is
 * accepted, exactly once; failures keep the import and surface a safe message
 * in the dialog (never raw backend detail).
 */
function useImportDeletion(options?: { onDeleted?: (importId: string) => void }) {
  const router = useRouter();
  const { showSuccess } = useErrorToast();
  const [pendingDeletion, setPendingDeletion] = useState<DeletableImport | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function requestDeletion(item: DeletableImport) {
    setDeleteError(null);
    setPendingDeletion(item);
  }

  function cancelDeletion() {
    if (deletingImportId) {
      return;
    }
    setPendingDeletion(null);
    setDeleteError(null);
  }

  async function confirmDeleteImport() {
    const item = pendingDeletion;
    if (!item || deletingImportId) {
      return;
    }

    setDeletingImportId(item.importId);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/imports/${item.importId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        setDeletingImportId(null);
        setDeleteError(DELETE_IMPORT_ERROR_MESSAGE);
        return;
      }
    } catch {
      setDeletingImportId(null);
      setDeleteError(DELETE_IMPORT_ERROR_MESSAGE);
      return;
    }

    setDeletingImportId(null);
    setPendingDeletion(null);
    options?.onDeleted?.(item.importId);
    router.refresh();
    showSuccess(DELETE_IMPORT_SUCCESS_MESSAGE);
  }

  return { pendingDeletion, deletingImportId, deleteError, requestDeletion, cancelDeletion, confirmDeleteImport };
}

/** The shared delete confirmation, rendered identically wherever imports can be deleted. */
function ImportDeleteDialog({ deletion }: { deletion: ReturnType<typeof useImportDeletion> }) {
  return (
    <AppConfirmDialog
      open={deletion.pendingDeletion !== null}
      title="Delete this import?"
      description={deletion.pendingDeletion ? describeImportDeletion(deletion.pendingDeletion) : null}
      confirmLabel="Delete import"
      loadingLabel="Deleting…"
      destructive
      loading={deletion.deletingImportId !== null}
      error={deletion.deleteError}
      onConfirm={() => void deletion.confirmDeleteImport()}
      onCancel={deletion.cancelDeletion}
    />
  );
}

export function TemplateFieldPicker(props: { imports: TemplateFieldItem[]; initialImportId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [selectedImportId, setSelectedImportId] = useState(() =>
    props.initialImportId && props.imports.some((entry) => entry.importId === props.initialImportId)
      ? props.initialImportId
      : ""
  );
  const [selectedByImport, setSelectedByImport] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(props.imports.map((entry) => [entry.importId, entry.selectedColumns]))
  );
  // Imports deleted from this picker disappear immediately; the server refresh
  // that follows makes the removal durable and clears these local tombstones.
  const [removedImportIds, setRemovedImportIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();

  const visibleImports = useMemo(
    () => props.imports.filter((entry) => !removedImportIds.includes(entry.importId)),
    [props.imports, removedImportIds]
  );

  const deletion = useImportDeletion({
    onDeleted: (importId) => {
      setRemovedImportIds((current) => [...current, importId]);
      // Never leave a deleted import selected — Save disables until another is picked.
      setSelectedImportId((current) => (current === importId ? "" : current));
    }
  });

  const selectedImport = useMemo(
    () => (selectedImportId ? visibleImports.find((entry) => entry.importId === selectedImportId) : undefined),
    [visibleImports, selectedImportId]
  );
  useErrorToastEffect(state.error, "Template field save failed");

  const selectedColumns = selectedImport ? selectedByImport[selectedImport.importId] ?? [] : [];

  useEffect(() => {
    setRemovedImportIds([]);
    setSelectedByImport(Object.fromEntries(props.imports.map((entry) => [entry.importId, entry.selectedColumns])));
    setSelectedImportId((current) => (props.imports.some((entry) => entry.importId === current) ? current : ""));
  }, [props.imports]);

  // Clicking anywhere outside the picker closes the panel — except while the
  // delete confirmation (a body-level portal) is up, so cancelling a delete
  // returns the user to the still-open list.
  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (deletion.pendingDeletion !== null) {
        return;
      }
      if (pickerRef.current && event.target instanceof Node && !pickerRef.current.contains(event.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen, deletion.pendingDeletion]);

  function focusOption(index: number) {
    const options = panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-import-option]");
    if (!options || options.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(options.length - 1, index));
    options[clamped]?.focus();
  }

  function closePicker() {
    setPickerOpen(false);
    triggerRef.current?.focus();
  }

  function chooseImport(importId: string) {
    setSelectedImportId(importId);
    setState({ pending: false, error: undefined });
    closePicker();
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPickerOpen(true);
      window.requestAnimationFrame(() => focusOption(0));
      return;
    }
    if (event.key === "Escape" && pickerOpen) {
      event.preventDefault();
      setPickerOpen(false);
    }
  }

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-import-option]") ?? []);
      const activeIndex = options.findIndex((option) => option === document.activeElement);
      focusOption(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    }
  }

  function toggleColumn(column: string) {
    if (!selectedImport) {
      return;
    }

    setSelectedByImport((current) => {
      const existing = current[selectedImport.importId] ?? [];
      const next = existing.includes(column)
        ? existing.filter((entry) => entry !== column)
        : existing.length >= MAX_TEMPLATE_COLUMNS
          ? existing
          : [...existing, column];

      return {
        ...current,
        [selectedImport.importId]: next
      };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedImport) {
      return;
    }

    const selectedColumnsForImport = selectedByImport[selectedImport.importId] ?? [];
    if (selectedColumnsForImport.length === 0) {
      setState({ pending: false, error: "Choose at least one template column." });
      return;
    }

    setState({ pending: true });

    const response = await fetch(`/api/imports/${selectedImport.importId}/template-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedColumns: selectedColumnsForImport
      })
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Could not save template columns." });
      return;
    }

    setSelectedImportId("");
    router.refresh();
    setState({ pending: false });
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field" data-imports-tour="pending-selector">
        <label htmlFor={triggerId}>Import</label>
        {visibleImports.length === 0 ? (
          <div className={pickerStyles.empty}>
            <span className={pickerStyles.emptyTitle}>{IMPORT_PICKER_EMPTY_TITLE}</span>
            <span className={pickerStyles.emptyHint}>{IMPORT_PICKER_EMPTY_HINT}</span>
          </div>
        ) : (
          <div className={pickerStyles.picker} ref={pickerRef}>
            <button
              ref={triggerRef}
              id={triggerId}
              type="button"
              className={`${pickerStyles.trigger}${pickerOpen ? ` ${pickerStyles.triggerOpen}` : ""}`}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label={IMPORT_PICKER_LABEL}
              onClick={() => setPickerOpen((current) => !current)}
              onKeyDown={onTriggerKeyDown}
            >
              <span
                className={`${pickerStyles.triggerText}${selectedImport ? "" : ` ${pickerStyles.triggerPlaceholder}`}`}
              >
                {selectedImport ? selectedImport.fileName : IMPORT_PICKER_PLACEHOLDER}
              </span>
              <ChevronDown
                className={`${pickerStyles.chevron}${pickerOpen ? ` ${pickerStyles.chevronOpen}` : ""}`}
                aria-hidden="true"
              />
            </button>
            {pickerOpen ? (
              <div className={pickerStyles.panel} ref={panelRef} onKeyDown={onPanelKeyDown}>
                <ul className={pickerStyles.list} aria-label="Imports awaiting template fields">
                  {visibleImports.map((entry) => {
                    const isSelected = entry.importId === selectedImportId;

                    return (
                      <li
                        key={entry.importId}
                        className={`${pickerStyles.row}${isSelected ? ` ${pickerStyles.rowSelected}` : ""}`}
                      >
                        <button
                          type="button"
                          data-import-option
                          className={pickerStyles.rowSelect}
                          aria-pressed={isSelected}
                          onClick={() => chooseImport(entry.importId)}
                        >
                          <span className={pickerStyles.rowName}>
                            <span className={pickerStyles.rowNameText} title={entry.fileName}>
                              {entry.fileName}
                            </span>
                            {isSelected ? <Check className={pickerStyles.check} aria-hidden="true" /> : null}
                          </span>
                          <span className={pickerStyles.rowMeta}>
                            {importPickerRowMeta({ rowCount: entry.rowCount, columnCount: entry.columns.length })}
                          </span>
                        </button>
                        {/* A separate button, never nested in the row's select action —
                            clicking the trash only stages the confirmation. */}
                        <button
                          type="button"
                          className={pickerStyles.rowDelete}
                          aria-label={deleteImportLabel(entry.fileName)}
                          disabled={deletion.deletingImportId !== null}
                          onClick={() =>
                            deletion.requestDeletion({
                              importId: entry.importId,
                              fileName: entry.fileName,
                              linkedCampaignCount: entry.linkedCampaignCount ?? 0
                            })
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {selectedImport ? (
        <>
          <div className="selection-summary">
            <strong>
              {selectedColumns.length} / {MAX_TEMPLATE_COLUMNS} template fields selected
            </strong>
          </div>
          <div className="checkbox-grid" data-imports-tour="active-field-selection">
            {selectedImport.columns.map((column) => {
              const checked = selectedColumns.includes(column.normalized);
              const disableUnchecked = !checked && selectedColumns.length >= MAX_TEMPLATE_COLUMNS;

              return (
                <label key={column.normalized} className={`checkbox-card${checked ? " is-selected" : ""}${disableUnchecked ? " is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disableUnchecked}
                    onChange={() => toggleColumn(column.normalized)}
                  />
                  <span>{formatColumnLabel(column)}</span>
                </label>
              );
            })}
          </div>
          <div className="pill-row">
            {selectedImport.columns
              .filter((column) => selectedColumns.includes(column.normalized))
              .map((column) => (
                <span key={column.normalized} className="pill" title={`Saved as ${column.normalized}`}>
                  {column.sourceName}
                </span>
              ))}
          </div>
        </>
      ) : null}
      <button
        className="button"
        type="submit"
        data-imports-tour="save-template-fields"
        disabled={state.pending || !selectedImport}
      >
        {state.pending ? "Saving fields..." : "Save template fields"}
      </button>
      <ImportDeleteDialog deletion={deletion} />
    </form>
  );
}

export function MappingLibrary(props: { items: MappingLibraryItem[] }) {
  const [editingImportId, setEditingImportId] = useState<string | null>(null);
  const deletion = useImportDeletion({
    onDeleted: (importId) => {
      if (editingImportId === importId) {
        setEditingImportId(null);
      }
    }
  });
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useErrorToastEffect(error, "Import update failed");
  const totalPages = Math.max(1, Math.ceil(props.items.length / IMPORTS_PAGE_SIZE));
  const visibleItems = props.items.slice((page - 1) * IMPORTS_PAGE_SIZE, page * IMPORTS_PAGE_SIZE);
  const editingItem = editingImportId
    ? props.items.find((item) => item.importId === editingImportId) ?? null
    : null;

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(props.items.length / IMPORTS_PAGE_SIZE))));
  }, [props.items.length]);

  // Publish the "what changed" marker so the Help menu can offer a short tour of
  // the processed-import card once the user has at least one. Layout-neutral.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    if (props.items.length > 0) {
      root.dataset.tourChangedStage = "changed";
    } else {
      delete root.dataset.tourChangedStage;
    }
    return () => {
      delete document.documentElement.dataset.tourChangedStage;
    };
  }, [props.items.length]);

  // If the import open in the editor disappears (deleted here or gone after a
  // refresh), close the dialog rather than leaving it stranded.
  useEffect(() => {
    if (editingImportId && !props.items.some((item) => item.importId === editingImportId)) {
      setEditingImportId(null);
    }
  }, [editingImportId, props.items]);

  return (
    <div className="imports-library">
      {visibleItems.map((item, index) => {
        // The first visible card carries the guided-tour targets, so the Imports
        // help guide always finds an anchor when any processed import is shown.
        const isTourAnchor = index === 0;
        const isDeleting = deletion.deletingImportId === item.importId;
        const activeTemplateFields = item.selectedTemplateColumns;
        const selectedColumns = item.columns.filter((column) => activeTemplateFields.includes(column.normalized));
        const detectedOnlyColumns = item.columns.filter((column) => !activeTemplateFields.includes(column.normalized));
        const visibleSelectedColumns = selectedColumns.slice(0, 5);
        const hiddenSelectedColumnCount = Math.max(0, selectedColumns.length - visibleSelectedColumns.length);
        const visibleDetectedColumns = detectedOnlyColumns.slice(0, 4);
        const hiddenDetectedColumnCount = Math.max(0, detectedOnlyColumns.length - visibleDetectedColumns.length);
        const visiblePreviewRows = item.previewRows.slice(0, 2);
        const hiddenPreviewCount = Math.max(0, item.rowCount - visiblePreviewRows.length);

        return (
          <article
            className="import-card"
            key={item.importId}
            data-imports-tour={isTourAnchor ? "import-card" : undefined}
          >
            <div className="import-card__header">
              <div className="import-card__primary">
                <div className="import-card__title-row">
                  <strong className="import-card__title">{item.fileName}</strong>

                  <div className="import-card__meta">
                    <span className="badge">{item.status}</span>
                    <span className="import-card__metric">
                      {item.rowCount} {item.rowCount === 1 ? "contact" : "contacts"}
                    </span>
                    {item.linkedCampaignCount ? (
                      <span className="import-card__metric">
                        {item.linkedCampaignCount} sequence{item.linkedCampaignCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>

                {item.updatedAt ? (
                  <div className="import-card__meta import-card__meta--secondary">
                    <span className="import-card__meta-text">Updated {item.updatedAt}</span>
                  </div>
                ) : null}
              </div>

              <div className="import-card__actions">
                <button
                  type="button"
                  className="field-icon-button"
                  data-tooltip="Edit import"
                  data-imports-tour={isTourAnchor ? "edit-import" : undefined}
                  onClick={() => {
                    setEditingImportId(item.importId);
                    setError(null);
                  }}
                  disabled={isDeleting}
                  aria-label={editImportLabel(item.fileName)}
                >
                  <PencilLine aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="field-icon-button field-icon-button--danger"
                  data-tooltip="Delete import"
                  data-imports-tour={isTourAnchor ? "delete-import" : undefined}
                  onClick={() => deletion.requestDeletion(item)}
                  disabled={isDeleting}
                  aria-label={`Delete ${item.fileName} import`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="import-card__content">
              <div
                className="import-card__section import-card__section--columns"
                data-imports-tour={isTourAnchor ? "active-template-fields" : undefined}
              >
                <div className="import-card__section-head">
                  <div className="import-card__section-heading">
                    <span className="import-card__section-label">Template fields</span>
                    <p className="import-card__section-copy">
                      {activeTemplateFields.length} of {item.columns.length} detected columns are active in templates.
                    </p>
                  </div>
                </div>

                {visibleSelectedColumns.length ? (
                  <div className="import-card__field-pill-row">
                    {visibleSelectedColumns.map((column) => (
                      <span
                        key={`${item.importId}-${column.normalized}`}
                        className="import-card__field-pill import-card__field-pill--selected"
                        title={`Saved as ${column.normalized}`}
                      >
                        {column.sourceName}
                      </span>
                    ))}
                    {hiddenSelectedColumnCount ? (
                      <span className="import-card__field-pill import-card__field-pill--overflow">+{hiddenSelectedColumnCount} more</span>
                    ) : null}
                  </div>
                ) : (
                  <span className="muted">No template fields are selected for this import yet.</span>
                )}

                {visibleDetectedColumns.length ? (
                  <div
                    className="import-card__detected-summary"
                    data-imports-tour={isTourAnchor ? "other-detected-columns" : undefined}
                  >
                    <span className="import-card__detected-label">Other detected columns</span>
                    <div className="import-card__field-pill-row import-card__field-pill-row--muted">
                      {visibleDetectedColumns.map((column) => (
                        <span
                          key={`${item.importId}-${column.normalized}-detected`}
                          className="import-card__field-pill import-card__field-pill--muted"
                          title={`Detected as ${column.normalized}`}
                        >
                          {column.sourceName}
                        </span>
                      ))}
                      {hiddenDetectedColumnCount ? (
                        <span className="import-card__field-pill import-card__field-pill--overflow">+{hiddenDetectedColumnCount} more</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className="import-card__section import-card__section--preview"
                data-imports-tour={isTourAnchor ? "sample-contacts" : undefined}
              >
                <div className="import-card__section-head">
                  <div className="import-card__section-heading">
                    <span className="import-card__section-label">Sample contacts</span>
                    <p className="import-card__section-copy">A quick peek at the people in this import.</p>
                  </div>
                  <span className="import-card__section-count">{Math.min(item.rowCount, visiblePreviewRows.length)}</span>
                </div>
                {item.previewRows.length ? (
                  <div className="import-card__preview-list">
                    {visiblePreviewRows.map((row) => (
                      <div key={row.id} className="import-card__preview-item">
                        <strong>{row.primary}</strong>
                        <span>{row.secondary}</span>
                        <span>{row.tertiary}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="muted">No preview available</span>
                )}
                {hiddenPreviewCount ? (
                  <span className="import-card__preview-more">+{hiddenPreviewCount} more contacts in this import</span>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}

      {props.items.length > IMPORTS_PAGE_SIZE ? (
        <div className="imports-pagination" data-imports-tour="imports-pagination">
          <button
            type="button"
            className="imports-pagination__button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            aria-label="Previous imports page"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span className="imports-pagination__count">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="imports-pagination__button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page === totalPages}
            aria-label="Next imports page"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {editingItem ? (
        <ImportEditorDialog key={editingItem.importId} item={editingItem} onClose={() => setEditingImportId(null)} />
      ) : null}

      <ImportDeleteDialog deletion={deletion} />
    </div>
  );
}

/**
 * Unified editor for a processed import, opened by the card's pencil action.
 * Renders through a body-level portal so it never alters the Import card's
 * dimensions. One Save coordinates the two existing endpoints — rename
 * (`PATCH /api/imports/:id`) and template-field selection
 * (`POST /api/imports/:id/template-fields`) — running only the parts the user
 * changed. No new import is created; contacts and sequence associations are
 * untouched. Deselecting a column only drops it from the active template
 * variables, never the stored import data.
 */
function ImportEditorDialog({ item, onClose }: { item: MappingLibraryItem; onClose: () => void }) {
  const router = useRouter();
  const { showSuccess } = useErrorToast();
  const [mounted, setMounted] = useState(false);
  const [draftName, setDraftName] = useState(item.fileName);
  const [draftColumns, setDraftColumns] = useState<string[]>(() => [...item.selectedTemplateColumns]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const subtitleId = useId();
  const nameInputId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape closes the editor, but never mid-save — closing while a partial
  // update is in flight could hide that only one change persisted.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  function toggle(column: string) {
    setDraftColumns((current) => toggleTemplateColumn(current, column));
    setError(null);
  }

  async function handleSave() {
    if (saving) {
      // Re-entry guard: rapid clicks never fire a second set of updates.
      return;
    }

    // Diff against the live item prop so a retry after a partial failure only
    // re-sends the still-pending change (the succeeded part is now the baseline).
    const plan = planImportEdit(
      { name: item.fileName, selectedColumns: item.selectedTemplateColumns },
      { name: draftName, selectedColumns: draftColumns }
    );

    if (plan.kind === "noop") {
      onClose();
      return;
    }

    if (plan.kind === "invalid") {
      setError(plan.error);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (plan.nameChanged) {
        const response = await fetch(`/api/imports/${item.importId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: plan.name })
        });
        if (!response.ok) {
          throw new Error("rename-failed");
        }
      }

      if (plan.fieldsChanged) {
        const response = await fetch(`/api/imports/${item.importId}/template-fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedColumns: plan.selectedColumns })
        });
        if (!response.ok) {
          throw new Error("fields-failed");
        }
      }
    } catch {
      // Keep the dialog open and refetch the true state so the card (and this
      // dialog's baseline) reflect whatever actually persisted. Never claim both
      // changes saved when only one did; never surface backend detail.
      setSaving(false);
      setError(EDIT_IMPORT_ERROR_MESSAGE);
      router.refresh();
      return;
    }

    setSaving(false);
    router.refresh();
    showSuccess(EDIT_IMPORT_SUCCESS_MESSAGE);
    onClose();
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className={editorStyles.backdrop}
      role="presentation"
      onMouseDown={() => {
        if (!saving) {
          onClose();
        }
      }}
    >
      <div
        className={editorStyles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        data-imports-editor="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={editorStyles.header}>
          <div className={editorStyles.headerText}>
            <h2 id={titleId}>{EDIT_IMPORT_TITLE}</h2>
            <p id={subtitleId} className={editorStyles.headerSubtitle}>
              Rename this import or change which detected columns are active template fields. Your contacts and existing
              sequence associations stay attached to the same import.
            </p>
          </div>
          <CircularCloseButton label="Close Edit import" onClick={onClose} disabled={saving} />
        </header>

        <div className={editorStyles.body}>
          {error ? (
            <p className={editorStyles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={editorStyles.field}>
            <label htmlFor={nameInputId}>{EDIT_IMPORT_NAME_LABEL}</label>
            <input
              id={nameInputId}
              className={editorStyles.nameInput}
              value={draftName}
              maxLength={IMPORT_NAME_MAX_LENGTH}
              onChange={(event) => {
                setDraftName(event.target.value);
                setError(null);
              }}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className={editorStyles.field}>
            <div className={editorStyles.fieldsHead}>
              <span className={editorStyles.groupLabel}>{EDIT_IMPORT_FIELDS_LABEL}</span>
              <p className={editorStyles.fieldsHint}>{EDIT_IMPORT_FIELDS_HINT}</p>
            </div>
            <span className={editorStyles.summary}>
              {draftColumns.length} / {MAX_TEMPLATE_COLUMNS} active
            </span>
            <div className="checkbox-grid">
              {item.columns.map((column) => {
                const checked = draftColumns.includes(column.normalized);
                const disableUnchecked = !checked && draftColumns.length >= MAX_TEMPLATE_COLUMNS;

                return (
                  <label
                    key={`${item.importId}-${column.normalized}-editor`}
                    className={`checkbox-card${checked ? " is-selected" : ""}${disableUnchecked ? " is-disabled" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disableUnchecked || saving}
                      onChange={() => toggle(column.normalized)}
                    />
                    <span>{formatColumnLabel(column)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <footer className={editorStyles.footer}>
          <button
            type="button"
            className={`button secondary ${editorStyles.footerButton}`}
            onClick={onClose}
            disabled={saving}
          >
            {EDIT_IMPORT_CANCEL_LABEL}
          </button>
          <button
            type="button"
            className={`button ${editorStyles.footerButton}`}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 aria-hidden="true" className={editorStyles.spin} />
                {EDIT_IMPORT_SAVING_LABEL}
              </>
            ) : (
              EDIT_IMPORT_SAVE_LABEL
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
