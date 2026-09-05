import "@/lib/env";
import { PrismaClient } from "@prisma/client";

// The shared application client logs Prisma errors, which can contain row values.
const prisma = new PrismaClient({ log: [] });
import { parseNameRepairArgs, repairDiscoverPersonNames } from "@/services/prospects/discover-person-name-backfill";

async function main() {
  const options = parseNameRepairArgs(process.argv.slice(2));
  console.info(JSON.stringify({ mode: options.apply ? "APPLY" : "DRY_RUN", ...await repairDiscoverPersonNames(prisma, options) }));
}
main().catch(() => {
  // Database/client errors may contain names, SQL values or credentials.
  console.error(JSON.stringify({ error: "repair_failed" }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
