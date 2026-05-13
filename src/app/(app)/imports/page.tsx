import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { UploadImportForm } from "@/components/forms";
import { MappingLibrary, TemplateFieldPicker } from "@/components/mapping-library";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPaginationParams } from "@/lib/pagination";

const IMPORTS_PAGE_SIZE = 5;

export default async function ImportsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const pagination = getPaginationParams(resolvedSearchParams, {
    defaultPageSize: IMPORTS_PAGE_SIZE,
    maxPageSize: IMPORTS_PAGE_SIZE
  });
  const where = { userId: user.id };
  const [imports, totalImports] = await Promise.all([
    prisma.import.findMany({
      where,
      include: {
        columns: true,
        rows: { take: 5, orderBy: { rowIndex: "asc" } },
        _count: {
          select: {
            campaigns: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.import.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalImports / IMPORTS_PAGE_SIZE));

  if (pagination.page > totalPages) {
    redirect(pagination.page === 1 ? "/imports" : `/imports?page=${totalPages}`);
  }

  const mappings = await prisma.mapping.findMany({
    where: {
      userId: user.id,
      importId: {
        in: imports.map((entry) => entry.id)
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const latestMappings = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

  const templateFieldItems = imports.flatMap((entry) => {
    const mapping = latestMappings.get(entry.id);
    const hasBeenConfigured = mapping ? mapping.updatedAt.getTime() !== mapping.createdAt.getTime() : false;

    if (hasBeenConfigured) {
      return [];
    }

    return [{
      importId: entry.id,
      fileName: entry.fileName,
      columns: entry.columns.map((column) => ({
        sourceName: column.sourceName,
        normalized: column.normalized
      })),
      selectedColumns: Object.values((mapping?.variableMap ?? {}) as Record<string, string>).slice(0, 10)
    }];
  });

  const mappingItems = imports.map((entry) => {
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
        <article className="card">
          <h1 style={{ marginTop: 0 }}>Upload your people list</h1>
          <p className="muted">Upload a CSV or spreadsheet to create an audience.</p>
          <UploadImportForm />
        </article>
        <article className="card">
          <h2 style={{ marginTop: 0 }}>Template fields</h2>
          <p className="muted">Choose fields for newly reviewed imports here. Anything already saved can be edited in the imports list below.</p>
          <TemplateFieldPicker imports={templateFieldItems} />
        </article>
      </section>

      <section className="card">
        <h2>Imports</h2>
        <p className="muted">Review, rename, reselect template fields, page through, or delete imported audiences in one place.</p>
        <MappingLibrary items={mappingItems} />
        {totalImports > IMPORTS_PAGE_SIZE ? (
          <div className="imports-pagination">
            {pagination.page > 1 ? (
              <Link
                className="imports-pagination__button"
                href={pagination.page - 1 === 1 ? "/imports" : `/imports?page=${pagination.page - 1}`}
                aria-label="Previous imports page"
              >
                <ChevronLeft aria-hidden="true" />
              </Link>
            ) : (
              <span className="imports-pagination__button" aria-disabled="true" aria-label="Previous imports page">
                <ChevronLeft aria-hidden="true" />
              </span>
            )}
            <span className="imports-pagination__count">
              {pagination.page} / {totalPages}
            </span>
            {pagination.page < totalPages ? (
              <Link
                className="imports-pagination__button"
                href={`/imports?page=${pagination.page + 1}`}
                aria-label="Next imports page"
              >
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : (
              <span className="imports-pagination__button" aria-disabled="true" aria-label="Next imports page">
                <ChevronRight aria-hidden="true" />
              </span>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
