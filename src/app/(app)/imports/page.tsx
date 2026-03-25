import { UploadImportForm } from "@/components/forms";
import { MappingLibrary, TemplateFieldPicker } from "@/components/mapping-library";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ImportsPage() {
  const user = await requireUser();
  const [imports, mappings] = await Promise.all([
    prisma.import.findMany({
      where: { userId: user.id },
      include: { columns: true, rows: { take: 5, orderBy: { rowIndex: "asc" } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.mapping.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const latestMappings = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

  const templateFieldItems = imports.map((entry) => {
    const mapping = latestMappings.get(entry.id);

    return {
      importId: entry.id,
      fileName: entry.fileName,
      columns: entry.columns.map((column) => ({
        sourceName: column.sourceName,
        normalized: column.normalized
      })),
      selectedColumns: Object.values((mapping?.variableMap ?? {}) as Record<string, string>).slice(0, 10)
    };
  });

  const mappingItems = imports.map((entry) => {
    const mapping = latestMappings.get(entry.id);

    return {
      importId: entry.id,
      fileName: entry.fileName,
      rowCount: entry.rowCount,
      updatedAt: mapping?.updatedAt.toLocaleString()
    };
  });

  return (
    <div className="stack">
      <section className="grid cols-2">
        <article className="card">
          <h1 style={{ marginTop: 0 }}>Upload your people list</h1>
          <p className="muted">Upload a CSV or spreadsheet to create an audience.</p>
          <UploadImportForm />
        </article>
        <article className="card">
          <h2 style={{ marginTop: 0 }}>Template fields</h2>
          <p className="muted">Choose which columns from each audience can be used in templates.</p>
          <TemplateFieldPicker imports={templateFieldItems} />
        </article>
      </section>

      <section className="card">
        <h2>Imports</h2>
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Detected columns</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.fileName}</td>
                <td>
                  <span className="badge">{entry.status}</span>
                </td>
                <td>{entry.rowCount}</td>
                <td>
                  <div className="pill-row">
                    {entry.columns.map((column) => (
                      <span key={column.id} className="pill" title={`Saved as ${column.normalized}`}>
                        {column.sourceName}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  {entry.rows.length ? (
                    <div className="recipient-preview">
                      {entry.rows.map((row) => {
                        const payload = row.normalized as Record<string, string>;
                        return (
                          <div key={row.id}>
                            <strong>{payload.name || payload.first_name || row.email || "Recipient"}</strong>
                            <span>{row.email ?? "No email"}</span>
                            <span>{payload.company || payload.organization || "No company"}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="muted">No preview available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Rename imported audiences</h2>
        <p className="muted">Give each imported list a clear name.</p>
        <MappingLibrary items={mappingItems} />
      </section>
    </div>
  );
}
