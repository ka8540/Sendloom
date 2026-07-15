import { FileSpreadsheet, SlidersHorizontal, UploadCloud } from "lucide-react";

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
    <div className="imports-dashboard">
      <header className="imports-dashboard__hero">
        <div>
          <span className="imports-dashboard__kicker">Audience library</span>
          <h1>Imports</h1>
          <p>Upload, map, and manage the people lists that power your sequences.</p>
        </div>
      </header>

      <section className="imports-setup-grid" aria-label="Import setup">
        <article className="card imports-setup-card" id="import-upload" data-imports-tour="upload">
          <header className="imports-setup-card__header">
            <span className="imports-setup-card__icon" aria-hidden="true">
              <UploadCloud />
            </span>
            <div>
              <h2>Upload people</h2>
              <p>Add a CSV or spreadsheet to create an audience.</p>
            </div>
          </header>
          <UploadImportForm />
        </article>
        <article className="card imports-setup-card" data-imports-tour="template-fields">
          <header className="imports-setup-card__header">
            <span className="imports-setup-card__icon" aria-hidden="true">
              <SlidersHorizontal />
            </span>
            <div>
              <h2>Template fields</h2>
              <p>Choose personalization fields for imports awaiting review.</p>
            </div>
          </header>
          <TemplateFieldPicker imports={templateFieldItems} initialImportId={pendingImportId} />
        </article>
      </section>

      <section className="card imports-library-shell" data-imports-tour="imports-list" aria-labelledby="imports-library-heading">
        <header className="imports-library-shell__header">
          <div className="imports-library-shell__heading">
            <div className="imports-library-shell__title">
              <span className="imports-library-shell__icon" aria-hidden="true">
                <FileSpreadsheet />
              </span>
              <h2 id="imports-library-heading">People lists</h2>
              <span className="imports-library-shell__count" aria-label={`${mappingItems.length} processed imports`}>
                {mappingItems.length}
              </span>
            </div>
            <p>Processed imports ready to review, edit, or use in a sequence.</p>
          </div>
        </header>
        <MappingLibrary items={mappingItems} />
      </section>
    </div>
  );
}
