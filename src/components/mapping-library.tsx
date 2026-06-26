"use client";

import { ChevronLeft, ChevronRight, Loader2, PencilLine, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import editorStyles from "@/components/import-editor-dialog.module.css";
import {
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
  MAX_TEMPLATE_COLUMNS,
  editImportLabel,
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

  const selectedImport = useMemo(
    () => (selectedImportId ? props.imports.find((entry) => entry.importId === selectedImportId) : undefined),
    [props.imports, selectedImportId]
  );
  useErrorToastEffect(state.error, "Template field save failed");

  const selectedColumns = selectedImport ? selectedByImport[selectedImport.importId] ?? [] : [];

  useEffect(() => {
    setSelectedByImport(Object.fromEntries(props.imports.map((entry) => [entry.importId, entry.selectedColumns])));
    setSelectedImportId((current) => (props.imports.some((entry) => entry.importId === current) ? current : ""));
  }, [props.imports]);

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

  if (props.imports.length === 0) {
    return <p className="muted">No pending imports need template-field setup here. Edit existing imports below.</p>;
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="template-field-import">Import</label>
        <select
          id="template-field-import"
          name="importId"
          data-imports-tour="pending-selector"
          value={selectedImportId}
          onChange={(event) => {
            setSelectedImportId(event.target.value);
            setState({ pending: false, error: undefined });
          }}
          required
        >
          <option value="">Select an import</option>
          {props.imports.map((entry) => (
            <option key={entry.importId} value={entry.importId}>
              {entry.fileName}
            </option>
          ))}
        </select>
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
    </form>
  );
}

export function MappingLibrary(props: { items: MappingLibraryItem[] }) {
  const router = useRouter();
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [editingImportId, setEditingImportId] = useState<string | null>(null);
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

  async function deleteImportItem(item: MappingLibraryItem) {
    const extraMessage = item.linkedCampaignCount
      ? ` This will also delete ${item.linkedCampaignCount} linked sequence${item.linkedCampaignCount === 1 ? "" : "s"}.`
      : "";

    if (!window.confirm(`Delete "${item.fileName}"?${extraMessage}`)) {
      return;
    }

    setDeletingImportId(item.importId);
    setError(null);

    const response = await fetch(`/api/imports/${item.importId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setDeletingImportId(null);
      setError(payload.error ?? "Could not delete the import.");
      return;
    }

    if (editingImportId === item.importId) {
      setEditingImportId(null);
    }

    router.refresh();
    setDeletingImportId(null);
  }

  return (
    <div className="imports-library">
      {visibleItems.map((item, index) => {
        // The first visible card carries the guided-tour targets, so the Imports
        // help guide always finds an anchor when any processed import is shown.
        const isTourAnchor = index === 0;
        const isDeleting = deletingImportId === item.importId;
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
                  onClick={() => void deleteImportItem(item)}
                  disabled={isDeleting}
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
          <button
            type="button"
            className={editorStyles.closeButton}
            onClick={onClose}
            disabled={saving}
            aria-label="Close editor"
          >
            <X aria-hidden="true" />
          </button>
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
