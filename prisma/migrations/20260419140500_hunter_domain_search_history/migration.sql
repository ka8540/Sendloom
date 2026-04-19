CREATE TABLE IF NOT EXISTS "public"."HunterDomainSearch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "results" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HunterDomainSearch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HunterDomainSearch_userId_domain_key"
ON "public"."HunterDomainSearch"("userId", "domain");

CREATE INDEX IF NOT EXISTS "HunterDomainSearch_userId_updatedAt_idx"
ON "public"."HunterDomainSearch"("userId", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'HunterDomainSearch_userId_fkey'
      AND table_name = 'HunterDomainSearch'
  ) THEN
    ALTER TABLE "public"."HunterDomainSearch"
    ADD CONSTRAINT "HunterDomainSearch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;
