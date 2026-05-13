import { redirect } from "next/navigation";

import { TemplatesWorkspace } from "@/components/templates-workspace";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPaginationParams } from "@/lib/pagination";
import type { TemplateFormat } from "@/lib/templates";

const TEMPLATES_PAGE_SIZE = 5;

export default async function TemplatesPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const pagination = getPaginationParams(resolvedSearchParams, {
    defaultPageSize: TEMPLATES_PAGE_SIZE,
    maxPageSize: TEMPLATES_PAGE_SIZE
  });
  const where = { userId: user.id };
  const [templates, totalTemplates] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.template.count({ where })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalTemplates / TEMPLATES_PAGE_SIZE));

  if (pagination.page > totalPages) {
    redirect(pagination.page === 1 ? "/templates" : `/templates?page=${totalPages}`);
  }

  return (
    <TemplatesWorkspace
      templates={templates.map((template) => ({
        id: template.id,
        name: template.name,
        subject: template.subject,
        format: (template.format as TemplateFormat | null) ?? "HTML",
        htmlBody: template.htmlBody,
        variableManifest: Array.isArray(template.variableManifest) ? (template.variableManifest as string[]) : []
      }))}
      pagination={{
        page: pagination.page,
        pageSize: TEMPLATES_PAGE_SIZE,
        total: totalTemplates,
        totalPages
      }}
    />
  );
}
