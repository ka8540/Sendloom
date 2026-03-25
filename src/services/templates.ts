import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { extractTemplateVariables, renderTemplate, sanitizeTemplatePreview } from "@/lib/templates";
import type { MergeVariables } from "@/lib/types";

export async function upsertTemplate(input: {
  id?: string;
  name: string;
  subject: string;
  htmlBody: string;
  previewPayload?: Record<string, unknown>;
}, userId: string) {
  const variableManifest = Array.from(
    new Set([...extractTemplateVariables(input.subject), ...extractTemplateVariables(input.htmlBody)])
  );

  if (input.id) {
    await prisma.template.findFirstOrThrow({
      where: {
        id: input.id,
        userId
      }
    });

    return prisma.template.update({
      where: { id: input.id },
      data: {
        name: input.name,
        subject: input.subject,
        htmlBody: input.htmlBody,
        variableManifest,
        previewPayload: input.previewPayload as Prisma.InputJsonValue | undefined,
        version: {
          increment: 1
        }
      }
    });
  }

  return prisma.template.create({
    data: {
      userId,
      name: input.name,
      subject: input.subject,
      htmlBody: input.htmlBody,
      variableManifest,
      previewPayload: input.previewPayload as Prisma.InputJsonValue | undefined
    }
  });
}

export async function listTemplates(userId: string) {
  return prisma.template.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function previewTemplate(templateId: string, userId: string, payload: MergeVariables) {
  const template = await prisma.template.findFirstOrThrow({
    where: {
      id: templateId,
      userId
    }
  });

  return {
    subject: renderTemplate(template.subject, payload),
    html: sanitizeTemplatePreview(renderTemplate(template.htmlBody, payload))
  };
}
