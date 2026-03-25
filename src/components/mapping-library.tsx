"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const MAX_TEMPLATE_COLUMNS = 10;

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
  rowCount: number;
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
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>, importId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setSavingImportId(importId);
    setError(null);

    const formData = new FormData(form);
    const fileName = String(formData.get("fileName") || "").trim();

    const response = await fetch(`/api/imports/${importId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName })
    });

    if (!response.ok) {
      const payload = await response.json();
      setSavingImportId(null);
      setError(payload.error ?? "Could not update the audience name.");
      return;
    }

    router.refresh();
    setSavingImportId(null);
  }

  return (
    <div className="stack">
      {props.items.map((item) => (
        <article className="mapping-card" key={item.importId}>
          <div className="mapping-card__header">
            <div>
              <strong>{item.fileName}</strong>
              <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                {item.rowCount} people in this audience
              </p>
            </div>
            {item.updatedAt ? <span className="muted">Updated {item.updatedAt}</span> : null}
          </div>
          <form className="form" onSubmit={(event) => onSubmit(event, item.importId)}>
            <div className="field">
              <label htmlFor={`fileName-${item.importId}`}>Audience name</label>
              <input
                id={`fileName-${item.importId}`}
                name="fileName"
                defaultValue={item.fileName}
                maxLength={120}
                placeholder="Founder leads - April"
                required
              />
            </div>
            <button className="button secondary" type="submit" disabled={savingImportId === item.importId}>
              {savingImportId === item.importId ? "Saving name..." : "Save audience name"}
            </button>
          </form>
        </article>
      ))}
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
