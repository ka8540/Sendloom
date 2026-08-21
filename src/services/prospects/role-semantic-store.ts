import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { ConfidenceLevel, PositionCategory } from "@/lib/prospect-enums";
import { coerceConfidenceLevel, coercePositionCategory } from "@/lib/prospect-enums";
import { serializeEmbeddingVector, validateEmbeddingVector } from "@/services/prospects/role-embedding-service";
import type { RoleBreadth, RoleSpecialty } from "@/services/prospects/role-semantic-policy";

export type RoleSemanticIdentity = {
  embeddingModel: string;
  embeddingDimensions: number;
  semanticVersion: string;
};

export type RoleSemanticRecord = RoleSemanticIdentity & {
  id: string;
  normalizedTitle: string;
  canonicalRoleKey: string;
  category: PositionCategory;
  specialty: RoleSpecialty;
  breadth: RoleBreadth;
  classificationConfidence: ConfidenceLevel;
};

export type RoleSemanticWrite = Omit<RoleSemanticRecord, "id"> & { embedding: number[] };
export type RoleSemanticVector = RoleSemanticRecord & { embedding: number[] };
export type RoleSemanticSimilarity = RoleSemanticRecord & { queryKey: string; similarity: number };

export interface RoleSemanticStorePort {
  findByTitles(normalizedTitles: readonly string[], identity: RoleSemanticIdentity): Promise<Map<string, RoleSemanticRecord>>;
  findVectorsByTitles(
    normalizedTitles: readonly string[],
    identity: RoleSemanticIdentity
  ): Promise<Map<string, RoleSemanticVector>>;
  upsertMany(records: readonly RoleSemanticWrite[]): Promise<void>;
  findSimilarMany(
    queries: readonly { queryKey: string; category: PositionCategory; embedding: number[] }[],
    identity: RoleSemanticIdentity,
    topK: number
  ): Promise<RoleSemanticSimilarity[]>;
}

type RoleSemanticPrisma = Pick<PrismaClient, "prospectRoleSemantic" | "$executeRaw" | "$queryRaw">;

type RawVectorRow = {
  id: string;
  normalizedTitle: string;
  canonicalRoleKey: string;
  category: string;
  specialty: string;
  breadth: string;
  classificationConfidence: string;
  embeddingModel: string;
  embeddingDimensions: number;
  semanticVersion: string;
  embeddingText: string;
};

type RawSimilarityRow = Omit<RawVectorRow, "embeddingText"> & {
  queryKey: string;
  similarity: number;
};

function coerceSpecialty(value: string): RoleSpecialty {
  return value as RoleSpecialty;
}

function coerceBreadth(value: string): RoleBreadth {
  return value === "BROAD" ? "BROAD" : "NARROW";
}

function metadata(row: Omit<RawVectorRow, "embeddingText">): RoleSemanticRecord {
  return {
    id: row.id,
    normalizedTitle: row.normalizedTitle,
    canonicalRoleKey: row.canonicalRoleKey,
    category: coercePositionCategory(row.category),
    specialty: coerceSpecialty(row.specialty),
    breadth: coerceBreadth(row.breadth),
    classificationConfidence: coerceConfidenceLevel(row.classificationConfidence),
    embeddingModel: row.embeddingModel,
    embeddingDimensions: row.embeddingDimensions,
    semanticVersion: row.semanticVersion
  };
}

function parseVectorText(value: string, dimensions: number): number[] {
  return validateEmbeddingVector(JSON.parse(value) as unknown, dimensions);
}

/** Parameterized pgvector persistence/query boundary. No role text is interpolated into SQL. */
export class PrismaRoleSemanticStore implements RoleSemanticStorePort {
  constructor(private readonly prisma: RoleSemanticPrisma) {}

  async findByTitles(
    normalizedTitles: readonly string[],
    identity: RoleSemanticIdentity
  ): Promise<Map<string, RoleSemanticRecord>> {
    if (normalizedTitles.length === 0) return new Map();
    const rows = await this.prisma.prospectRoleSemantic.findMany({
      where: {
        normalizedTitle: { in: [...normalizedTitles] },
        embeddingModel: identity.embeddingModel,
        embeddingDimensions: identity.embeddingDimensions,
        semanticVersion: identity.semanticVersion
      },
      select: {
        id: true,
        normalizedTitle: true,
        canonicalRoleKey: true,
        category: true,
        specialty: true,
        breadth: true,
        classificationConfidence: true,
        embeddingModel: true,
        embeddingDimensions: true,
        semanticVersion: true
      }
    });
    return new Map(
      rows.map((row) => [
        row.normalizedTitle,
        metadata({ ...row, embeddingDimensions: Number(row.embeddingDimensions) })
      ])
    );
  }

  async findVectorsByTitles(
    normalizedTitles: readonly string[],
    identity: RoleSemanticIdentity
  ): Promise<Map<string, RoleSemanticVector>> {
    if (normalizedTitles.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<RawVectorRow[]>(Prisma.sql`
      SELECT
        "id", "normalizedTitle", "canonicalRoleKey", "category", "specialty", "breadth",
        "classificationConfidence", "embeddingModel", "embeddingDimensions", "semanticVersion",
        "embedding"::text AS "embeddingText"
      FROM "public"."ProspectRoleSemantic"
      WHERE "normalizedTitle" IN (${Prisma.join([...normalizedTitles])})
        AND "embeddingModel" = ${identity.embeddingModel}
        AND "embeddingDimensions" = ${identity.embeddingDimensions}
        AND "semanticVersion" = ${identity.semanticVersion}
    `);
    return new Map(
      rows.map((row) => [
        row.normalizedTitle,
        { ...metadata(row), embedding: parseVectorText(row.embeddingText, identity.embeddingDimensions) }
      ])
    );
  }

  async upsertMany(records: readonly RoleSemanticWrite[]): Promise<void> {
    for (const record of records) {
      const vector = serializeEmbeddingVector(record.embedding, record.embeddingDimensions);
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "public"."ProspectRoleSemantic" (
          "id", "normalizedTitle", "canonicalRoleKey", "category", "specialty", "breadth",
          "classificationConfidence", "embeddingModel", "embeddingDimensions", "semanticVersion",
          "embedding", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${record.normalizedTitle}, ${record.canonicalRoleKey}, ${record.category},
          ${record.specialty}, ${record.breadth}, ${record.classificationConfidence}, ${record.embeddingModel},
          ${record.embeddingDimensions}, ${record.semanticVersion}, ${vector}::vector,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("normalizedTitle", "embeddingModel", "embeddingDimensions", "semanticVersion")
        DO UPDATE SET
          "canonicalRoleKey" = EXCLUDED."canonicalRoleKey",
          "category" = EXCLUDED."category",
          "specialty" = EXCLUDED."specialty",
          "breadth" = EXCLUDED."breadth",
          "classificationConfidence" = EXCLUDED."classificationConfidence",
          "embedding" = EXCLUDED."embedding",
          "updatedAt" = CURRENT_TIMESTAMP
      `);
    }
  }

  async findSimilarMany(
    queries: readonly { queryKey: string; category: PositionCategory; embedding: number[] }[],
    identity: RoleSemanticIdentity,
    topK: number
  ): Promise<RoleSemanticSimilarity[]> {
    if (queries.length === 0 || topK <= 0) return [];
    const payload = queries.map((query) => ({
      queryKey: query.queryKey,
      category: query.category,
      embedding: serializeEmbeddingVector(query.embedding, identity.embeddingDimensions)
    }));
    const rows = await this.prisma.$queryRaw<RawSimilarityRow[]>(Prisma.sql`
      WITH requested AS (
        SELECT *
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          AS input("queryKey" text, "category" text, "embedding" text)
      ), ranked AS (
        SELECT
          input."queryKey",
          semantic."id", semantic."normalizedTitle", semantic."canonicalRoleKey", semantic."category",
          semantic."specialty", semantic."breadth", semantic."classificationConfidence",
          semantic."embeddingModel", semantic."embeddingDimensions", semantic."semanticVersion",
          1 - (semantic."embedding" <=> input."embedding"::vector) AS "similarity",
          ROW_NUMBER() OVER (
            PARTITION BY input."queryKey"
            ORDER BY semantic."embedding" <=> input."embedding"::vector, semantic."normalizedTitle"
          ) AS ordinal
        FROM requested input
        JOIN "public"."ProspectRoleSemantic" semantic ON semantic."category" = input."category"
        WHERE semantic."embeddingModel" = ${identity.embeddingModel}
          AND semantic."embeddingDimensions" = ${identity.embeddingDimensions}
          AND semantic."semanticVersion" = ${identity.semanticVersion}
      )
      SELECT
        "queryKey", "id", "normalizedTitle", "canonicalRoleKey", "category", "specialty", "breadth",
        "classificationConfidence", "embeddingModel", "embeddingDimensions", "semanticVersion", "similarity"
      FROM ranked
      WHERE ordinal <= ${Math.max(1, Math.min(Math.floor(topK), 50))}
      ORDER BY "queryKey", ordinal
    `);
    return rows.map((row) => ({ ...metadata(row), queryKey: row.queryKey, similarity: Number(row.similarity) }));
  }
}
