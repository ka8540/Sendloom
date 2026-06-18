-- Prospect graph backend (backend-only prototype).
-- Adds the Company -> Position -> People graph plus the search record and a
-- global title-classification cache. All statements are idempotent so the
-- migration is safe to re-apply against a partially-migrated database.

-- CreateTable: ProspectCompany
CREATE TABLE IF NOT EXISTS "public"."ProspectCompany" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "officialName" TEXT,
  "officialDomain" TEXT,
  "officialWebsite" TEXT,
  "linkedinUrl" TEXT,
  "domainConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailPattern" TEXT,
  "patternConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "patternEvidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProspectCompanyPosition
CREATE TABLE IF NOT EXISTS "public"."ProspectCompanyPosition" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "rawTitles" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectCompanyPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProspectPerson
CREATE TABLE IF NOT EXISTS "public"."ProspectPerson" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "sourceProfileId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "currentTitle" TEXT,
  "normalizedTitle" TEXT,
  "location" TEXT,
  "country" TEXT,
  "state" TEXT,
  "city" TEXT,
  "linkedinUrl" TEXT NOT NULL,
  "inferredEmail" TEXT,
  "emailStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailConfidence" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "emailPattern" TEXT,
  "emailSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProspectSearch
CREATE TABLE IF NOT EXISTS "public"."ProspectSearch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT,
  "requestedCompany" TEXT NOT NULL,
  "requestedDomain" TEXT,
  "requestedLinkedin" TEXT,
  "requestedTitles" JSONB NOT NULL,
  "requestedLocations" JSONB,
  "maxResults" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "apifyRunId" TEXT,
  "apifyDatasetId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "totalFound" INTEGER NOT NULL DEFAULT 0,
  "totalProcessed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ProspectSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProspectTitleClassification (global AI-result cache)
CREATE TABLE IF NOT EXISTS "public"."ProspectTitleClassification" (
  "id" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
  "source" TEXT NOT NULL DEFAULT 'AI',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectTitleClassification_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectCompany_userId_normalizedName_key"
  ON "public"."ProspectCompany"("userId", "normalizedName");
CREATE INDEX IF NOT EXISTS "ProspectCompany_userId_officialDomain_idx"
  ON "public"."ProspectCompany"("userId", "officialDomain");

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectCompanyPosition_companyId_category_key"
  ON "public"."ProspectCompanyPosition"("companyId", "category");
CREATE INDEX IF NOT EXISTS "ProspectCompanyPosition_companyId_idx"
  ON "public"."ProspectCompanyPosition"("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectPerson_userId_sourceProfileId_key"
  ON "public"."ProspectPerson"("userId", "sourceProfileId");
CREATE INDEX IF NOT EXISTS "ProspectPerson_companyId_positionId_idx"
  ON "public"."ProspectPerson"("companyId", "positionId");
CREATE INDEX IF NOT EXISTS "ProspectPerson_userId_emailStatus_idx"
  ON "public"."ProspectPerson"("userId", "emailStatus");

CREATE INDEX IF NOT EXISTS "ProspectSearch_userId_createdAt_idx"
  ON "public"."ProspectSearch"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProspectSearch_status_idx"
  ON "public"."ProspectSearch"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectTitleClassification_normalizedTitle_key"
  ON "public"."ProspectTitleClassification"("normalizedTitle");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectCompany_userId_fkey' AND table_name = 'ProspectCompany') THEN
    ALTER TABLE "public"."ProspectCompany"
      ADD CONSTRAINT "ProspectCompany_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectCompanyPosition_companyId_fkey' AND table_name = 'ProspectCompanyPosition') THEN
    ALTER TABLE "public"."ProspectCompanyPosition"
      ADD CONSTRAINT "ProspectCompanyPosition_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "public"."ProspectCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectPerson_userId_fkey' AND table_name = 'ProspectPerson') THEN
    ALTER TABLE "public"."ProspectPerson"
      ADD CONSTRAINT "ProspectPerson_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectPerson_companyId_fkey' AND table_name = 'ProspectPerson') THEN
    ALTER TABLE "public"."ProspectPerson"
      ADD CONSTRAINT "ProspectPerson_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "public"."ProspectCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectPerson_positionId_fkey' AND table_name = 'ProspectPerson') THEN
    ALTER TABLE "public"."ProspectPerson"
      ADD CONSTRAINT "ProspectPerson_positionId_fkey"
      FOREIGN KEY ("positionId") REFERENCES "public"."ProspectCompanyPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectSearch_userId_fkey' AND table_name = 'ProspectSearch') THEN
    ALTER TABLE "public"."ProspectSearch"
      ADD CONSTRAINT "ProspectSearch_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectSearch_companyId_fkey' AND table_name = 'ProspectSearch') THEN
    ALTER TABLE "public"."ProspectSearch"
      ADD CONSTRAINT "ProspectSearch_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "public"."ProspectCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
