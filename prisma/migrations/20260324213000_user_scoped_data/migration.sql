ALTER TABLE "public"."Import"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "public"."Mapping"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "public"."Template"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "public"."Campaign"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "public"."Suppression"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "Import_userId_idx" ON "public"."Import"("userId");
CREATE INDEX IF NOT EXISTS "Mapping_userId_idx" ON "public"."Mapping"("userId");
CREATE INDEX IF NOT EXISTS "Template_userId_idx" ON "public"."Template"("userId");
CREATE INDEX IF NOT EXISTS "Campaign_userId_idx" ON "public"."Campaign"("userId");
CREATE INDEX IF NOT EXISTS "Suppression_userId_idx" ON "public"."Suppression"("userId");

DROP INDEX IF EXISTS "public"."Suppression_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Suppression_userId_email_key" ON "public"."Suppression"("userId", "email");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Import_userId_fkey'
      AND table_name = 'Import'
  ) THEN
    ALTER TABLE "public"."Import"
    ADD CONSTRAINT "Import_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Mapping_userId_fkey'
      AND table_name = 'Mapping'
  ) THEN
    ALTER TABLE "public"."Mapping"
    ADD CONSTRAINT "Mapping_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Template_userId_fkey'
      AND table_name = 'Template'
  ) THEN
    ALTER TABLE "public"."Template"
    ADD CONSTRAINT "Template_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Campaign_userId_fkey'
      AND table_name = 'Campaign'
  ) THEN
    ALTER TABLE "public"."Campaign"
    ADD CONSTRAINT "Campaign_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Suppression_userId_fkey'
      AND table_name = 'Suppression'
  ) THEN
    ALTER TABLE "public"."Suppression"
    ADD CONSTRAINT "Suppression_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
