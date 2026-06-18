// A tiny in-memory stand-in for the subset of PrismaClient the prospect graph
// uses. It is intentionally minimal — it only supports the exact query shapes
// the services and DataLoaders issue — but it keeps real referential state so
// tests can assert on the resulting Company -> Positions -> People graph.

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

type Row = Record<string, any>;

function valueMatches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && "in" in (expected as Row)) {
    return ((expected as Row).in as unknown[]).includes(actual);
  }
  return actual === expected;
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

export function createFakePrisma() {
  const companies: Row[] = [];
  const positions: Row[] = [];
  const people: Row[] = [];
  const searches: Row[] = [];
  const titleCache: Row[] = [];

  const companyById = (id: string) => companies.find((row) => row.id === id);

  function matchPerson(row: Row, where: Row): boolean {
    for (const [key, expected] of Object.entries(where)) {
      if (key === "position") {
        const position = positions.find((p) => p.id === row.positionId);
        if (!position || !valueMatches(position.category, (expected as Row).category)) {
          return false;
        }
        continue;
      }
      if (!valueMatches(row[key], expected)) {
        return false;
      }
    }
    return true;
  }

  function matchPosition(row: Row, where: Row): boolean {
    for (const [key, expected] of Object.entries(where)) {
      if (key === "company") {
        const company = companyById(row.companyId);
        if (!company || !valueMatches(company.userId, (expected as Row).userId)) {
          return false;
        }
        continue;
      }
      if (!valueMatches(row[key], expected)) {
        return false;
      }
    }
    return true;
  }

  function matchGeneric(row: Row, where: Row): boolean {
    for (const [key, expected] of Object.entries(where)) {
      if (!valueMatches(row[key], expected)) {
        return false;
      }
    }
    return true;
  }

  function deleteRows(rows: Row[], predicate: (row: Row) => boolean): number {
    let count = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (predicate(rows[index])) {
        rows.splice(index, 1);
        count += 1;
      }
    }
    return count;
  }

  const now = () => new Date();

  return {
    // Direct access for assertions in tests.
    _state: { companies, positions, people, searches, titleCache },

    prospectSearch: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: nextId("search"), createdAt: now(), updatedAt: now(), totalProcessed: 0, totalFound: 0, ...data };
        searches.push(row);
        return { ...row };
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = searches.find((r) => matchGeneric(r, where));
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: Row }) => searches.filter((r) => matchGeneric(r, where)).map((r) => ({ ...r })),
      count: async ({ where }: { where: Row }) => searches.filter((r) => matchGeneric(r, where)).length,
      deleteMany: async ({ where }: { where: Row }) => {
        const count = deleteRows(searches, (r) => matchGeneric(r, where ?? {}));
        return { count };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = searches.find((r) => r.id === where.id);
        Object.assign(row!, data, { updatedAt: now() });
        return { ...row };
      }
    },

    prospectCompany: {
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const composite = where.userId_normalizedName;
        let row = composite
          ? companies.find((r) => r.userId === composite.userId && r.normalizedName === composite.normalizedName)
          : companies.find((r) => r.id === where.id);
        if (row) {
          Object.assign(row, update, { updatedAt: now() });
        } else {
          row = { id: nextId("company"), createdAt: now(), updatedAt: now(), ...create };
          companies.push(row);
        }
        return { ...row };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = companies.find((r) => r.id === where.id);
        Object.assign(row!, data, { updatedAt: now() });
        return { ...row };
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = companies.find((r) => matchGeneric(r, where));
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }: { where: Row }) => {
        const row = companies.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: Row }) => companies.filter((r) => matchGeneric(r, where ?? {})).map((r) => ({ ...r })),
      count: async ({ where }: { where: Row }) => companies.filter((r) => matchGeneric(r, where ?? {})).length,
      delete: async ({ where }: { where: Row }) => {
        const index = companies.findIndex((r) => r.id === where.id);
        const row = companies[index];
        if (!row) {
          throw new Error("Company not found.");
        }
        companies.splice(index, 1);
        return { ...row };
      }
    },

    prospectCompanyPosition: {
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const composite = where.companyId_category;
        let row = positions.find((r) => r.companyId === composite.companyId && r.category === composite.category);
        if (row) {
          Object.assign(row, update, { updatedAt: now() });
        } else {
          row = { id: nextId("position"), createdAt: now(), updatedAt: now(), ...create };
          positions.push(row);
        }
        return { ...row };
      },
      findMany: async ({ where }: { where: Row }) => positions.filter((r) => matchPosition(r, where ?? {})).map((r) => ({ ...r })),
      deleteMany: async ({ where }: { where: Row }) => {
        const count = deleteRows(positions, (r) => matchPosition(r, where ?? {}));
        return { count };
      }
    },

    prospectPerson: {
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const composite = where.userId_sourceProfileId;
        let row = people.find((r) => r.userId === composite.userId && r.sourceProfileId === composite.sourceProfileId);
        if (row) {
          Object.assign(row, update, { updatedAt: now() });
        } else {
          row = { id: nextId("person"), createdAt: now(), updatedAt: now(), ...create };
          people.push(row);
        }
        return { ...row };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = people.find((r) => r.id === where.id);
        Object.assign(row!, data, { updatedAt: now() });
        return { ...row };
      },
      findMany: async ({ where }: { where: Row }) => people.filter((r) => matchPerson(r, where ?? {})).map((r) => ({ ...r })),
      count: async ({ where }: { where: Row }) => people.filter((r) => matchPerson(r, where ?? {})).length,
      deleteMany: async ({ where }: { where: Row }) => {
        const count = deleteRows(people, (r) => matchPerson(r, where ?? {}));
        return { count };
      },
      groupBy: async ({ by, where }: { by: string[]; where: Row }) => {
        const key = by[0];
        const counts = new Map<string, number>();
        for (const row of people.filter((r) => matchPerson(r, where ?? {}))) {
          counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([value, count]) => ({ [key]: value, _count: { _all: count } }));
      }
    },

    prospectTitleClassification: {
      findMany: async ({ where }: { where: Row }) =>
        titleCache.filter((r) => valueMatches(r.normalizedTitle, where.normalizedTitle)).map((r) => ({ ...r })),
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        let row = titleCache.find((r) => r.normalizedTitle === where.normalizedTitle);
        if (row) {
          Object.assign(row, update, { updatedAt: now() });
        } else {
          row = { id: nextId("title"), createdAt: now(), updatedAt: now(), ...create };
          titleCache.push(row);
        }
        return { ...row };
      }
    }
  };
}
