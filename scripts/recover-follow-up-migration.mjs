import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const migrationName = "20260522120000_follow_up_emails";
const prisma = new PrismaClient();

async function main() {
  try {
    const failedMigrations = await prisma.$queryRaw`
      SELECT id
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
        AND finished_at IS NULL
        AND rolled_back_at IS NULL
      LIMIT 1
    `;

    if (failedMigrations.length === 0) {
      console.log(`No failed ${migrationName} migration to recover.`);
      return;
    }

    console.log(`Marking failed ${migrationName} migration attempt as rolled back before retrying.`);
    const result = spawnSync(
      "npx",
      ["prisma", "migrate", "resolve", "--rolled-back", migrationName],
      { stdio: "inherit" }
    );

    if (result.status !== 0) {
      throw new Error(`prisma migrate resolve exited with status ${result.status ?? "unknown"}`);
    }
  } catch (error) {
    if (error?.code === "P2010" && error?.meta?.code === "42P01") {
      console.log("No Prisma migrations table found yet; skipping follow-up migration recovery.");
      return;
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
