import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getPaginationMeta, type PaginationParams } from "@/lib/pagination";
import {
  extractTemplateVariables,
  renderTemplate,
  renderTemplatePreview,
  type TemplateFormat,
  validateTemplateBody
} from "@/lib/templates";
import type { MergeVariables } from "@/lib/types";

export async function upsertTemplate(input: {
  id?: string;
  name: string;
  subject: string;
  format: TemplateFormat;
  htmlBody: string;
  previewPayload?: Record<string, unknown>;
}, userId: string) {
  const bodyValidationError = validateTemplateBody(input.format, input.htmlBody);
  if (bodyValidationError) {
    throw new Error(bodyValidationError);
  }

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
        format: input.format,
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
      format: input.format,
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

export async function listTemplatesPage(userId: string, pagination: PaginationParams) {
  const where = { userId };
  const [items, total] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.template.count({ where })
  ]);

  return {
    items,
    ...getPaginationMeta(pagination.page, pagination.pageSize, total)
  };
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
    html: renderTemplatePreview(template.format as TemplateFormat, template.htmlBody, payload)
  };
}
