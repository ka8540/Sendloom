/**
 * Local prospect-graph smoke test.
 *
 *   npm run prospect:test -- --user <userId> --company "Apple" \
 *     --titles "Software Engineer,Technical Recruiter,Data Analyst" \
 *     --locations "United States" --max 8
 *
 * Authenticates as an explicit local user id (or the first user / ADMIN_EMAIL),
 * runs the full create -> process pipeline against the real providers, and
 * prints ONLY counts and the Company -> Positions -> People structure. Email
 * local parts are redacted so the output is safe to share. No API tokens are
 * ever printed.
 *
 * Requires APIFY_API_TOKEN (and OPENAI_API_KEY for AI steps). Keep --max small.
 */
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createProspectServices } from "@/services/prospects/prospect-services";
import { createProspectSearchSchema } from "@/services/prospects/prospect-validation";

type Args = {
  userId?: string;
  company: string;
  titles: string[];
  locations: string[];
  max: number;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    userId: get("--user"),
    company: get("--company") ?? "Apple",
    titles: (get("--titles") ?? "Software Engineer,Technical Recruiter,Data Analyst")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    locations: (get("--locations") ?? "United States")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    max: Math.min(Number(get("--max") ?? "8"), 10)
  };
}

function redactEmail(email: string | null): string {
  if (!email) {
    return "—";
  }
  const [local, domain] = email.split("@");
  if (!domain) {
    return "[redacted]";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

async function resolveUserId(explicit?: string): Promise<string> {
  if (explicit) {
    const user = await prisma.user.findUnique({ where: { id: explicit } });
    if (!user) {
      throw new Error(`No user with id ${explicit}.`);
    }
    return user.id;
  }

  const user = env.ADMIN_EMAIL
    ? await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL.toLowerCase() } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  if (!user) {
    throw new Error("No local user found. Pass --user <userId>.");
  }
  return user.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!env.PROSPECT_GRAPH_ENABLED) {
    console.warn("PROSPECT_GRAPH_ENABLED is false — set it to true in .env for local testing.");
  }
  if (!env.APIFY_API_TOKEN) {
    throw new Error("APIFY_API_TOKEN is required to run the prospect pipeline.");
  }

  const userId = await resolveUserId(args.userId);
  const services = createProspectServices(prisma);

  const validated = createProspectSearchSchema.parse({
    companyName: args.company,
    jobTitles: args.titles,
    locations: args.locations,
    maxResults: args.max
  });

  console.log(`Creating prospect search for "${args.company}" (max ${args.max})...`);
  const created = await services.prospectSearch.createSearch(userId, validated);
  console.log(`Search ${created.id} created. Processing...`);

  const processed = await services.prospectSearch.processSearch(userId, created.id);
  if (processed.status !== "READY") {
    console.error(`Search ended as ${processed.status}: [${processed.errorCode}] ${processed.errorMessage}`);
    return;
  }

  const company = processed.companyId
    ? await prisma.prospectCompany.findUnique({ where: { id: processed.companyId } })
    : null;

  if (!company) {
    console.error("No company resolved.");
    return;
  }

  const positions = await prisma.prospectCompanyPosition.findMany({ where: { companyId: company.id } });
  const people = await prisma.prospectPerson.findMany({ where: { companyId: company.id, userId } });

  console.log("");
  console.log(`Company: ${company.officialName ?? company.name} (${company.officialDomain ?? "domain unknown"})`);
  console.log(`Pattern: ${company.emailPattern ?? "none"} (${company.patternConfidence})`);
  console.log("");

  const peopleByPosition = new Map<string, typeof people>();
  for (const person of people) {
    const bucket = peopleByPosition.get(person.positionId) ?? [];
    bucket.push(person);
    peopleByPosition.set(person.positionId, bucket);
  }

  let candidatesGenerated = 0;
  for (const position of positions.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    const bucket = peopleByPosition.get(position.id) ?? [];
    console.log(`${position.category}: ${bucket.length}`);
    for (const person of bucket) {
      if (person.inferredEmail) {
        candidatesGenerated += 1;
      }
      console.log(
        `   - ${person.fullName} — ${person.currentTitle ?? "?"} — ${redactEmail(person.inferredEmail)} [${person.emailStatus}]`
      );
    }
  }

  console.log("");
  console.log(`Total people: ${people.length}`);
  console.log(`Candidates generated: ${candidatesGenerated}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
