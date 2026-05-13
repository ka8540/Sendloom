import { TemplatesWorkspace } from "@/components/templates-workspace";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { TemplateFormat } from "@/lib/templates";

export default async function TemplatesPage() {
  const user = await requireOperatorUser();
  const templates = await prisma.template.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });

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
    />
  );
}
