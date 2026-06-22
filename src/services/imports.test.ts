import { beforeEach, describe, expect, it, vi } from "vitest";

type ImportColumnRow = { sourceName: string; normalized: string; sampleType: string; sampleValue: string };
type ImportRow = {
  id: string;
  userId: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  status: string;
  rowCount: number;
  sampleRows: unknown;
  columns: ImportColumnRow[];
};
type MappingRow = {
  id: string;
  userId: string;
  importId: string;
  reservedFieldMap: Record<string, string>;
  variableMap: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
};

const db = { imports: [] as ImportRow[], mappings: [] as MappingRow[] };

// Strictly increasing clock so an updated mapping always has updatedAt > createdAt.
let clock = 1_000;
function nextDate() {
  clock += 1_000;
  return new Date(clock);
}

function matchesWhere(row: ImportRow, where: { id?: string; userId?: string; status?: string }) {
  return (
    (where.id === undefined || row.id === where.id) &&
    (where.userId === undefined || row.userId === where.userId) &&
    (where.status === undefined || row.status === where.status)
  );
}

vi.mock("@/lib/db", () => ({
  prisma: {
    import: {
      create: vi.fn(async ({ data, include }: { data: Record<string, unknown>; include?: { columns?: boolean } }) => {
        const columns: ImportColumnRow[] = (
          (data.columns as { create?: ImportColumnRow[] } | undefined)?.create ?? []
        ).map((column) => ({ ...column }));
        const row: ImportRow = {
          id: data.id as string,
          userId: data.userId as string,
          fileName: data.fileName as string,
          fileType: data.fileType as string,
          storagePath: data.storagePath as string,
          status: data.status as string,
          rowCount: data.rowCount as number,
          sampleRows: data.sampleRows,
          columns
        };
        db.imports.push(row);
        return include?.columns ? { ...row, columns } : { ...row };
      }),
      findFirstOrThrow: vi.fn(
        async ({ where, include }: { where: { id?: string; userId?: string }; include?: { columns?: boolean } }) => {
          const row = db.imports.find((entry) => matchesWhere(entry, where));
          if (!row) {
            throw new Error("Import not found.");
          }
          return include?.columns ? { ...row, columns: row.columns } : { ...row };
        }
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id?: string; userId?: string; status?: string }; data: { status?: string } }) => {
          let count = 0;
          for (const row of db.imports) {
            if (matchesWhere(row, where)) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        }
      )
    },
    mapping: {
      create: vi.fn(async ({ data }: { data: Omit<MappingRow, "id" | "createdAt" | "updatedAt"> }) => {
        const now = nextDate();
        const row: MappingRow = {
          id: `mapping_${db.mappings.length + 1}`,
          userId: data.userId,
          importId: data.importId,
          reservedFieldMap: data.reservedFieldMap,
          variableMap: data.variableMap,
          createdAt: now,
          updatedAt: now
        };
        db.mappings.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: { where: { importId?: string; userId?: string } }) => {
        const rows = db.mappings.filter(
          (entry) =>
            (where.importId === undefined || entry.importId === where.importId) &&
            (where.userId === undefined || entry.userId === where.userId)
        );
        return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MappingRow> }) => {
        const row = db.mappings.find((entry) => entry.id === where.id);
        if (!row) {
          throw new Error("Mapping not found.");
        }
        Object.assign(row, data);
        row.updatedAt = nextDate();
        return { ...row };
      })
    }
  }
}));

vi.mock("@/lib/storage", () => ({
  buildImportKey: (userId: string, importId: string, fileName: string) =>
    `users/${userId}/imports/${importId}/${fileName}`,
  uploadObject: vi.fn(async () => ({})),
  deleteObject: vi.fn(async () => {})
}));

const { createImport, saveTemplateFields } = await import("@/services/imports");

const CSV = Buffer.from(
  ["First Name,Last Name,Email,Company", "Ada,Lovelace,ada@esri.com,Esri", "Alan,Turing,alan@esri.com,Esri"].join("\n"),
  "utf8"
);

beforeEach(() => {
  db.imports = [];
  db.mappings = [];
  clock = 1_000;
  vi.clearAllMocks();
});

describe("createImport", () => {
  it("creates a manual upload as PROCESSED with default activated columns", async () => {
    const created = await createImport("people.csv", "text/csv", CSV, "user_1");

    expect(created.status).toBe("PROCESSED");
    expect(db.imports).toHaveLength(1);
    expect(db.mappings).toHaveLength(1);
    expect(Object.keys(db.mappings[0].variableMap).length).toBeGreaterThan(0);
  });

  it("stages a Discover import as pending with no activated columns", async () => {
    const created = await createImport("sendloom-esri.xlsx", "application/xlsx", CSV, "user_1", {
      pendingFieldSelection: true
    });

    expect(created.status).toBe("UPLOADING");
    expect(db.imports).toHaveLength(1);
    expect(db.imports[0].rowCount).toBe(2);
    // Mapping exists (so the picker can leave it once saved) but nothing is active yet.
    expect(db.mappings).toHaveLength(1);
    expect(db.mappings[0].variableMap).toEqual({});
  });
});

describe("saveTemplateFields finalizes a pending import", () => {
  it("transitions UPLOADING -> PROCESSED and persists the selected fields without duplicating the import", async () => {
    const created = await createImport("sendloom-esri.xlsx", "application/xlsx", CSV, "user_1", {
      pendingFieldSelection: true
    });

    await saveTemplateFields(created.id, "user_1", ["email", "first_name"]);

    expect(db.imports).toHaveLength(1);
    expect(db.imports[0].status).toBe("PROCESSED");
    // Same mapping reused (not a second record), now carrying the chosen fields.
    expect(db.mappings).toHaveLength(1);
    expect(db.mappings[0].variableMap).toEqual({ email: "email", first_name: "first_name" });
  });

  it("is idempotent across repeated saves (no duplicate import or stuck status)", async () => {
    const created = await createImport("sendloom-esri.xlsx", "application/xlsx", CSV, "user_1", {
      pendingFieldSelection: true
    });

    await saveTemplateFields(created.id, "user_1", ["email"]);
    await saveTemplateFields(created.id, "user_1", ["email", "company"]);

    expect(db.imports).toHaveLength(1);
    expect(db.imports[0].status).toBe("PROCESSED");
    expect(db.mappings).toHaveLength(1);
    expect(db.mappings[0].variableMap).toEqual({ email: "email", company: "company" });
  });

  it("rejects unknown columns and leaves the import pending", async () => {
    const created = await createImport("sendloom-esri.xlsx", "application/xlsx", CSV, "user_1", {
      pendingFieldSelection: true
    });

    await expect(saveTemplateFields(created.id, "user_1", ["not_a_column"])).rejects.toThrow();
    expect(db.imports[0].status).toBe("UPLOADING");
  });

  it("does not let another user finalize the import", async () => {
    const created = await createImport("sendloom-esri.xlsx", "application/xlsx", CSV, "user_1", {
      pendingFieldSelection: true
    });

    await expect(saveTemplateFields(created.id, "user_2", ["email"])).rejects.toThrow();
    expect(db.imports[0].status).toBe("UPLOADING");
  });
});

describe("saveTemplateFields on a processed manual upload", () => {
  it("keeps the import PROCESSED and reuses the existing mapping", async () => {
    const created = await createImport("people.csv", "text/csv", CSV, "user_1");

    await saveTemplateFields(created.id, "user_1", ["email", "company"]);

    expect(db.imports).toHaveLength(1);
    expect(db.imports[0].status).toBe("PROCESSED");
    expect(db.mappings).toHaveLength(1);
    expect(db.mappings[0].variableMap).toEqual({ email: "email", company: "company" });
  });
});
