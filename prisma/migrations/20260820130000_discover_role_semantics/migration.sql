-- Additive pgvector role intelligence for Discover.
--
-- This stores one vector per normalized title/model/dimension/policy version.
-- Existing companies, people, searches, allocations, cache rows, and title
-- classifications are not rewritten. Exact vector search is intentional for
-- phase 1; add an ANN index only after measuring real unique-title volume.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "public"."ProspectRoleSemantic" (
  "id" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "canonicalRoleKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  "breadth" TEXT NOT NULL,
  "classificationConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
  "embeddingModel" TEXT NOT NULL,
  "embeddingDimensions" INTEGER NOT NULL,
  "semanticVersion" TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectRoleSemantic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectRoleSemantic_normalizedTitle_embeddingModel_embeddi_key"
  ON "public"."ProspectRoleSemantic"(
    "normalizedTitle", "embeddingModel", "embeddingDimensions", "semanticVersion"
  );

CREATE INDEX IF NOT EXISTS "ProspectRoleSemantic_category_specialty_idx"
  ON "public"."ProspectRoleSemantic"("category", "specialty");

CREATE INDEX IF NOT EXISTS "ProspectRoleSemantic_embeddingModel_embeddingDimensions_sem_idx"
  ON "public"."ProspectRoleSemantic"("embeddingModel", "embeddingDimensions", "semanticVersion");
