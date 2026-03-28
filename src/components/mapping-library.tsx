"use client";

import { Check, ChevronLeft, ChevronRight, PencilLine, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

const MAX_TEMPLATE_COLUMNS = 10;
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

export function TemplateFieldPicker(props: { imports: TemplateFieldItem[] }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [selectedImportId, setSelectedImportId] = useState(props.imports[0]?.importId ?? "");
  const [selectedByImport, setSelectedByImport] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(props.imports.map((entry) => [entry.importId, entry.selectedColumns]))
  );

  const selectedImport = useMemo(
    () => props.imports.find((entry) => entry.importId === selectedImportId) ?? props.imports[0],
    [props.imports, selectedImportId]
  );

  const selectedColumns = selectedImport ? selectedByImport[selectedImport.importId] ?? [] : [];

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

    router.refresh();
    setState({ pending: false });
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="template-field-import">Import</label>
        <select
          id="template-field-import"
          name="importId"
          value={selectedImportId}
          onChange={(event) => {
            setSelectedImportId(event.target.value);
            setState({ pending: false });
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
          <div className="checkbox-grid">
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
      <button className="button" type="submit" disabled={state.pending || !selectedImport}>
        {state.pending ? "Saving fields..." : "Save template fields"}
      </button>
      {state.error ? <p className="muted">{state.error}</p> : null}
    </form>
  );
}

export function MappingLibrary(props: { items: MappingLibraryItem[] }) {
  const router = useRouter();
  const [savingImportId, setSavingImportId] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [editingImportId, setEditingImportId] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.items.map((item) => [item.importId, item.fileName]))
  );
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(props.items.length / IMPORTS_PAGE_SIZE));
  const visibleItems = props.items.slice((page - 1) * IMPORTS_PAGE_SIZE, page * IMPORTS_PAGE_SIZE);

  useEffect(() => {
    setDraftNames(Object.fromEntries(props.items.map((item) => [item.importId, item.fileName])));
  }, [props.items]);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(props.items.length / IMPORTS_PAGE_SIZE))));
  }, [props.items.length]);

  async function saveImportName(importId: string) {
    setSavingImportId(importId);
    setError(null);
    const fileName = String(draftNames[importId] ?? "").trim();

    if (!fileName) {
      setSavingImportId(null);
      setError("Import name cannot be empty.");
      return;
    }

    const response = await fetch(`/api/imports/${importId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName })
    });

    if (!response.ok) {
      const payload = await response.json();
      setSavingImportId(null);
      setError(payload.error ?? "Could not update the import name.");
      return;
    }

    setEditingImportId(null);
    router.refresh();
    setSavingImportId(null);
  }

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

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>, importId: string, originalName: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveImportName(importId);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDraftNames((current) => ({
        ...current,
        [importId]: originalName
      }));
      setEditingImportId(null);
    }
  }

  return (
    <div className="imports-library">
      {visibleItems.map((item) => {
        const isEditing = editingImportId === item.importId;
        const isSaving = savingImportId === item.importId;
        const isDeleting = deletingImportId === item.importId;
        const visibleColumns = item.columns.slice(0, 8);
        const hiddenColumnCount = Math.max(0, item.columns.length - visibleColumns.length);
        const visiblePreviewRows = item.previewRows.slice(0, 3);
        const hiddenPreviewCount = Math.max(0, item.previewRows.length - visiblePreviewRows.length);

        return (
          <article className="import-card" key={item.importId}>
            <div className="import-card__header">
              <div className="import-card__primary">
                <div className="import-card__title-row">
                  {isEditing ? (
                    <input
                      className="import-card__name-input"
                      value={draftNames[item.importId] ?? item.fileName}
                      maxLength={120}
                      onChange={(event) =>
                        setDraftNames((current) => ({
                          ...current,
                          [item.importId]: event.target.value
                        }))
                      }
                      onKeyDown={(event) => handleNameKeyDown(event, item.importId, item.fileName)}
                      aria-label={`Rename ${item.fileName}`}
                      autoFocus
                    />
                  ) : (
                    <strong className="import-card__title">{item.fileName}</strong>
                  )}

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
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="field-icon-button"
                      data-tooltip="Save import name"
                      onClick={() => void saveImportName(item.importId)}
                      disabled={isSaving || isDeleting}
                    >
                      <Check aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="field-icon-button"
                      data-tooltip="Cancel rename"
                      onClick={() => {
                        setDraftNames((current) => ({
                          ...current,
                          [item.importId]: item.fileName
                        }));
                        setEditingImportId(null);
                      }}
                      disabled={isSaving || isDeleting}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="field-icon-button"
                    data-tooltip="Rename import"
                    onClick={() => {
                      setDraftNames((current) => ({
                        ...current,
                        [item.importId]: item.fileName
                      }));
                      setEditingImportId(item.importId);
                      setError(null);
                    }}
                    disabled={isSaving || isDeleting}
                  >
                    <PencilLine aria-hidden="true" />
                  </button>
                )}

                <button
                  type="button"
                  className="field-icon-button field-icon-button--danger"
                  data-tooltip="Delete import"
                  onClick={() => void deleteImportItem(item)}
                  disabled={isSaving || isDeleting}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="import-card__content">
              <div className="import-card__section import-card__section--columns">
                <div className="import-card__section-head">
                  <span className="import-card__section-label">Detected fields</span>
                  <span className="import-card__section-count">{item.columns.length}</span>
                </div>
                <div className="import-card__chip-row">
                  {visibleColumns.map((column) => (
                    <span
                      key={`${item.importId}-${column.normalized}`}
                      className="import-card__chip"
                      title={`Saved as ${column.normalized}`}
                    >
                      {column.sourceName}
                    </span>
                  ))}
                  {hiddenColumnCount ? (
                    <span className="import-card__chip import-card__chip--overflow">+{hiddenColumnCount} more</span>
                  ) : null}
                </div>
              </div>

              <div className="import-card__section import-card__section--preview">
                <div className="import-card__section-head">
                  <span className="import-card__section-label">Sample contacts</span>
                  <span className="import-card__section-count">{item.previewRows.length}</span>
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
        <div className="imports-pagination">
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

      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
