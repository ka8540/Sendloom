import { getRequestedImportId, resolveInitialImportId } from "@/components/imports-workflow-selection";
import { ImportsWorkspace } from "@/components/imports-workspace";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importIsFinalized, importNeedsFieldSelection } from "@/lib/imports-view";

export default async function ImportsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedImportId = getRequestedImportId(resolvedSearchParams);
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

  const workflowItems = imports.flatMap((entry) => {
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

  const initialImportId = requestedImportId
    ? resolveInitialImportId(workflowItems, requestedImportId)
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
    <ImportsWorkspace
      workflowItems={workflowItems}
      mappingItems={mappingItems}
      initialImportId={initialImportId}
      hasAnyImports={imports.length > 0}
    />
  );
}
