import { UploadImportForm } from "@/components/forms";
import { MappingLibrary, TemplateFieldPicker } from "@/components/mapping-library";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importIsFinalized, importNeedsFieldSelection } from "@/lib/imports-view";

export default async function ImportsPage({
  searchParams
}: {
  searchParams?: Promise<{ pendingImportId?: string | string[] }>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = (await searchParams) ?? {};
  const pendingImportIdParam = Array.isArray(resolvedSearchParams.pendingImportId)
    ? resolvedSearchParams.pendingImportId[0]
    : resolvedSearchParams.pendingImportId;
  const [imports, mappings] = await Promise.all([
    prisma.import.findMany({
      where: { userId: user.id },
      include: {
        columns: true,
        rows: { take: 5, orderBy: { rowIndex: "asc" } },
        _count: {
          select: {
            campaigns: true
          }
        }
      },
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

  const templateFieldItems = imports.flatMap((entry) => {
    const mapping = latestMappings.get(entry.id);

    if (!importNeedsFieldSelection(entry.status, mapping)) {
      return [];
    }

    return [{
      importId: entry.id,
      fileName: entry.fileName,
      rowCount: entry.rowCount,
      linkedCampaignCount: entry._count.campaigns,
      columns: entry.columns.map((column) => ({
        sourceName: column.sourceName,
        normalized: column.normalized
      })),
      selectedColumns: Object.values((mapping?.variableMap ?? {}) as Record<string, string>).slice(0, 10)
    }];
  });

  const pendingImportId =
    pendingImportIdParam && templateFieldItems.some((item) => item.importId === pendingImportIdParam)
      ? pendingImportIdParam
      : undefined;

  const mappingItems = imports.filter((entry) => importIsFinalized(entry.status)).map((entry) => {
    const mapping = latestMappings.get(entry.id);

    return {
      importId: entry.id,
      fileName: entry.fileName,
      status: entry.status,
      rowCount: entry.rowCount,
      linkedCampaignCount: entry._count.campaigns,
      updatedAt: entry.updatedAt.toLocaleString(),
      selectedTemplateColumns: Object.values((mapping?.variableMap ?? {}) as Record<string, string>),
      columns: entry.columns.map((column) => ({
        sourceName: column.sourceName,
        normalized: column.normalized
      })),
      previewRows: entry.rows.map((row) => {
        const payload = row.normalized as Record<string, string>;

        return {
          id: row.id,
          primary: payload.name || payload.first_name || row.email || "Recipient",
          secondary: row.email ?? "No email",
          tertiary: payload.company || payload.organization || "No company"
        };
      })
    };
  });

  return (
    <div className="stack">
      <section className="grid cols-2">
        <article className="card" data-imports-tour="upload">
          <h1 className="dashboard-page-title">Upload your people list</h1>
          <p className="muted dashboard-page-subtitle">Upload a CSV or spreadsheet to create an audience.</p>
          <UploadImportForm />
        </article>
        <article className="card" data-imports-tour="template-fields">
          <h2 className="dashboard-section-title">Template fields</h2>
          <p className="muted dashboard-body">Choose fields for newly reviewed imports here. Anything already saved can be edited in the imports list below.</p>
          <TemplateFieldPicker imports={templateFieldItems} initialImportId={pendingImportId} />
        </article>
      </section>

      <section className="card" data-imports-tour="imports-list">
        <h2 className="dashboard-section-title">Imports</h2>
        <p className="muted dashboard-body">Review, rename, reselect template fields, page through, or delete imported audiences in one place.</p>
        <MappingLibrary items={mappingItems} />
      </section>
    </div>
  );
}
