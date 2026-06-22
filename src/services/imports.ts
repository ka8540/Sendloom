import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { buildImportKey, deleteObject, uploadObject } from "@/lib/storage";
import { inferSampleType, parseSpreadsheet } from "@/lib/uploads";
import { normalizeHeader } from "@/lib/utils";

const MAX_TEMPLATE_COLUMNS = 10;

function detectColumn(columns: string[], patterns: string[]) {
  return columns.find((column) => patterns.some((pattern) => column.includes(pattern))) ?? "";
}

function createVariableMap(columns: string[], reservedFieldMap: Record<string, string>) {
  const prioritizedColumns = Array.from(
    new Set([
      reservedFieldMap.email,
      reservedFieldMap.name,
      reservedFieldMap.company,
      ...columns
    ].filter(Boolean))
  ).slice(0, MAX_TEMPLATE_COLUMNS);

  return Object.fromEntries(prioritizedColumns.map((column) => [column, column]));
}

async function getOwnedImport(importId: string, userId: string) {
  return prisma.import.findFirstOrThrow({
    where: {
      id: importId,
      userId
    }
  });
}

type CreateImportOptions = {
  /**
   * When true the import is staged as pending field selection (status
   * `UPLOADING`) with no template columns pre-activated. The operator must
   * choose fields and run {@link saveTemplateFields} to finalize it. Used by the
   * Discover "Add to Imports" flow so a generated audience behaves like an
   * uploaded spreadsheet awaiting review rather than an immediately processed
   * import.
   */
  pendingFieldSelection?: boolean;
};

export async function createImport(
  fileName: string,
  fileType: string,
  content: Buffer,
  userId: string,
  options: CreateImportOptions = {}
) {
  const parsed = parseSpreadsheet(fileName, content);
  const normalizedColumns = parsed.columns.map((column) => normalizeHeader(column));
  const pendingFieldSelection = options.pendingFieldSelection ?? false;

  const importId = randomUUID();
  const storageKey = buildImportKey(userId, importId, fileName);
  await uploadObject({
    bucket: "imports",
    key: storageKey,
    body: content,
    contentType: fileType || undefined,
    metadata: { userId, importId }
  });

  try {
    const createdImport = await prisma.import.create({
      data: {
        id: importId,
        userId,
        fileName,
        fileType,
        storagePath: storageKey,
        status: pendingFieldSelection ? "UPLOADING" : "PROCESSED",
        rowCount: parsed.rows.length,
        sampleRows: parsed.sampleRows as Prisma.InputJsonValue,
        columns: {
          create: parsed.columns.map((column) => ({
            sourceName: column,
            normalized: normalizeHeader(column),
            sampleType: inferSampleType(parsed.rows.find((row) => row[column] !== undefined)?.[column]),
            sampleValue: String(parsed.rows.find((row) => row[column] !== undefined)?.[column] ?? "")
          }))
        },
        rows: {
          create: parsed.rows.map((row, index) => {
            const normalized = Object.fromEntries(
              Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
            );
            const emailCandidate = Object.entries(normalized).find(([key]) => key.includes("email"))?.[1];
            return {
              rowIndex: index + 1,
              email: typeof emailCandidate === "string" ? emailCandidate.toLowerCase() : null,
              payload: row as Prisma.InputJsonValue,
              normalized: normalized as Prisma.InputJsonValue
            };
          })
        }
      },
      include: {
        columns: true
      }
    });

    const reservedFieldMap = {
      email: detectColumn(normalizedColumns, ["email", "mail"]),
      name: detectColumn(normalizedColumns, ["name", "full_name", "fullname"]),
      company: detectColumn(normalizedColumns, ["company", "organization", "org"])
    };

    // Pending imports must not auto-activate any template columns — the operator
    // selects fields during review. Storing an empty variableMap (with the
    // mapping created up front) keeps the import in the Template fields picker
    // until saveTemplateFields updates it, finalizing the import.
    const variableMap = pendingFieldSelection ? {} : createVariableMap(normalizedColumns, reservedFieldMap);

    await prisma.mapping.create({
      data: {
        userId,
        importId: createdImport.id,
        reservedFieldMap,
        variableMap
      }
    });

    return createdImport;
  } catch (error) {
    await deleteObject("imports", storageKey).catch(() => {});
    throw error;
  }
}

export async function getImportColumns(importId: string, userId: string) {
  return prisma.import.findFirstOrThrow({
    where: {
      id: importId,
      userId
    },
    include: {
      columns: true,
      rows: {
        take: 5,
        orderBy: { rowIndex: "asc" }
      }
    }
  });
}

export async function saveMapping(
  importId: string,
  userId: string,
  reservedFieldMap: Record<string, string>,
  variableMap: Record<string, string>
) {
  await getOwnedImport(importId, userId);

  const existing = await prisma.mapping.findFirst({
    where: {
      importId,
      userId
    },
    orderBy: { updatedAt: "desc" }
  });

  if (existing) {
    return prisma.mapping.update({
      where: { id: existing.id },
      data: {
        reservedFieldMap,
        variableMap
      }
    });
  }

  return prisma.mapping.create({
    data: {
      userId,
      importId,
      reservedFieldMap,
      variableMap
    }
  });
}

export async function updateImportName(importId: string, userId: string, fileName: string) {
  await getOwnedImport(importId, userId);

  return prisma.import.update({
    where: { id: importId },
    data: { fileName }
  });
}

export async function deleteImport(importId: string, userId: string) {
  const importRecord = await getOwnedImport(importId, userId);

  await prisma.$transaction(async (tx) => {
    await tx.campaign.deleteMany({
      where: {
        importId: importRecord.id
      }
    });

    await tx.mapping.deleteMany({
      where: {
        importId: importRecord.id
      }
    });

    await tx.import.delete({
      where: { id: importRecord.id }
    });
  });

  if (importRecord.storagePath) {
    await deleteObject("imports", importRecord.storagePath).catch(() => {});
  }

  return { id: importRecord.id, deleted: true };
}

export async function saveTemplateFields(importId: string, userId: string, selectedColumns: string[]) {
  const importRecord = await prisma.import.findFirstOrThrow({
    where: {
      id: importId,
      userId
    },
    include: {
      columns: true
    }
  });

  const normalizedColumns = importRecord.columns.map((column) => column.normalized);

  if (selectedColumns.length === 0) {
    throw new Error("Choose at least one column for templates.");
  }

  if (selectedColumns.length > MAX_TEMPLATE_COLUMNS) {
    throw new Error(`Choose up to ${MAX_TEMPLATE_COLUMNS} columns for templates.`);
  }

  const hasUnknownColumn = selectedColumns.some((column) => !normalizedColumns.includes(column));
  if (hasUnknownColumn) {
    throw new Error("One or more selected columns do not exist in this import.");
  }

  const existingMapping = await prisma.mapping.findFirst({
    where: {
      importId,
      userId
    },
    orderBy: { updatedAt: "desc" }
  });

  const reservedFieldMap =
    (existingMapping?.reservedFieldMap as Record<string, string> | null) ?? {
      email: detectColumn(normalizedColumns, ["email", "mail"]),
      name: detectColumn(normalizedColumns, ["name", "full_name", "fullname"]),
      company: detectColumn(normalizedColumns, ["company", "organization", "org"])
    };
  const variableMap = Object.fromEntries(Array.from(new Set(selectedColumns)).map((column) => [column, column]));

  const mapping = await saveMapping(importId, userId, reservedFieldMap, variableMap);

  // Finalize a pending import once its template fields are chosen. The
  // status-guarded updateMany only flips UPLOADING -> PROCESSED, so re-saving
  // fields on an already-processed import (the "Edit fields" flow) is a no-op
  // and repeated requests never duplicate work.
  if (importRecord.status === "UPLOADING") {
    await prisma.import.updateMany({
      where: { id: importId, userId, status: "UPLOADING" },
      data: { status: "PROCESSED" }
    });
  }

  return mapping;
}
