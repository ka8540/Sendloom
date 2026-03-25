import { read, utils } from "xlsx";
import { parse } from "csv-parse/sync";

type ParsedImport = {
  columns: string[];
  rows: Record<string, unknown>[];
  sampleRows: Record<string, unknown>[];
};

function normalizeRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : value])
  );
}

export function parseSpreadsheet(fileName: string, content: Buffer): ParsedImport {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv")) {
    const rows = parse(content, {
      columns: true,
      bom: true,
      skip_empty_lines: true
    }) as Record<string, unknown>[];
    const normalizedRows = rows.map(normalizeRecord);
    return {
      columns: normalizedRows.length ? Object.keys(normalizedRows[0]) : [],
      rows: normalizedRows,
      sampleRows: normalizedRows.slice(0, 5)
    };
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = read(content, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    const rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
      defval: ""
    });
    const normalizedRows = rows.map(normalizeRecord);
    return {
      columns: normalizedRows.length ? Object.keys(normalizedRows[0]) : [],
      rows: normalizedRows,
      sampleRows: normalizedRows.slice(0, 5)
    };
  }

  throw new Error("Unsupported file type. Upload CSV, XLS, or XLSX.");
}

export function inferSampleType(value: unknown) {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (value instanceof Date) {
    return "date";
  }
  return "string";
}
