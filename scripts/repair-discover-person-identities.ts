/**
 * Repair Discover people stored with a malformed identity.
 *
 * Before the canonical name parser existed, provider display names were split
 * on whitespace, so a LinkedIn name like "Jared Cho M.B.A." became the surname
 * "Cho M.B.A." and the inferred address jared.chomba@apple.com. "Jared C."
 * became jared.c@apple.com. Emoji, honorifics, middle initials, and
 * parenthetical aliases leaked in the same way.
 *
 *   npx tsx scripts/repair-discover-person-identities.ts --dry-run
 *   npx tsx scripts/repair-discover-person-identities.ts --apply
 *   npx tsx scripts/repair-discover-person-identities.ts --apply --resolve-identities
 *
 * Both stores are repaired: the user-owned ProspectPerson rows behind Search
 * History (ProspectSearchPerson points at them, so allocations heal for free)
 * and the shared DiscoverSearchCachePerson pool, so a future materialization
 * cannot re-import a bad identity.
 *
 * Guarantees:
 *  - --dry-run performs ZERO writes and is the default; --apply is explicit.
 *  - idempotent: a row is written only when a field genuinely differs, so a
 *    second run reports no pending corrections.
 *  - bounded batches, no deletes, no schema changes, no transaction spanning
 *    the table, and no other model is touched.
 *  - a stale malformed address is CLEARED even when no replacement can be
 *    generated. Nothing is ever guessed.
 *  - --resolve-identities additionally asks the conservative OpenAI resolver to
 *    complete genuinely incomplete names ("Jared C."). Off by default so a scan
 *    never costs money; a surname is adopted only on HIGH-confidence public
 *    evidence.
 *  - output is aggregate counts only — never a name, email, LinkedIn URL,
 *    model response, or connection string.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import {
  emptyRepairStats,
  planPersonIdentityRepair,
  recordRepairPlan,
  type IdentityRepairStats,
  type RepairableEmailFormat
} from "@/services/prospects/discover-identity-repair";
import {
  OpenAIPersonIdentityResolver,
  type PersonIdentityResolverPort
} from "@/services/prospects/openai-person-identity-resolution";
import { parsePersonName } from "@/services/prospects/prospect-person-name";

const BATCH_SIZE = 200;

type Options = { apply: boolean; resolveIdentities: boolean };

function parseArgs(argv: string[]): Options {
  return {
    apply: argv.includes("--apply"),
    resolveIdentities: argv.includes("--resolve-identities")
  };
}

/**
 * Sanitized database fingerprint so an operator can confirm WHICH database is
 * about to be written to. Host and database name only — never the user,
 * password, or query parameters.
 */
function databaseFingerprint(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return "unknown (DATABASE_URL is not set)";
  }
  try {
    const url = new URL(raw);
    const database = url.pathname.replace(/^\//, "") || "(none)";
    return `host=${url.hostname} port=${url.port || "default"} database=${database}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

function mergeStats(target: IdentityRepairStats, source: IdentityRepairStats): void {
  for (const key of Object.keys(target) as Array<keyof IdentityRepairStats>) {
    target[key] += source[key];
  }
}

function printStats(label: string, stats: IdentityRepairStats): void {
  console.info(`\n[${label}]`);
  for (const [key, value] of Object.entries(stats)) {
    console.info(`  ${key}: ${value}`);
  }
}

/**
 * Try to complete an incomplete identity from public professional evidence.
 * Returns null whenever a name could not be established — which is the normal,
 * safe outcome, and leaves the person with no address.
 */
async function resolveIdentity(
  resolver: PersonIdentityResolverPort,
  person: { firstName: string; lastName: string; fullName: string; currentTitle: string | null; location: string | null; linkedinUrl: string },
  company: { name: string; domain: string | null }
): Promise<{ firstName: string; lastName: string } | null> {
  const identity = parsePersonName({
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName
  });
  if (identity.status !== "AMBIGUOUS" && identity.status !== "INCOMPLETE") {
    return null;
  }
  const resolution = await resolver.resolve({
    displayName: person.fullName,
    knownFirstName: identity.firstName,
    knownFirstInitial: identity.firstInitial,
    companyName: company.name,
    companyDomain: company.domain,
    currentTitle: person.currentTitle,
    location: person.location,
    linkedinUrl: person.linkedinUrl
  });
  if (resolution.outcome !== "RESOLVED" || !resolution.firstName || !resolution.lastName) {
    return null;
  }
  return { firstName: resolution.firstName, lastName: resolution.lastName };
}

/**
 * Keyset-paginated batch readers. Extracted so each query's result type is
 * inferred independently of the loop variable it advances.
 */
function fetchProspectPeopleBatch(after: string | null) {
  return prisma.prospectPerson.findMany({
    take: BATCH_SIZE,
    where: after === null ? undefined : { id: { gt: after } },
    orderBy: { id: "asc" },
    include: {
      company: {
        select: {
          name: true,
          officialName: true,
          emailDomain: true,
          emailDomainConfidence: true,
          emailPattern: true,
          patternConfidence: true
        }
      }
    }
  });
}

function fetchCachePeopleBatch(after: string | null) {
  return prisma.discoverSearchCachePerson.findMany({
    take: BATCH_SIZE,
    where: after === null ? undefined : { id: { gt: after } },
    orderBy: { id: "asc" },
    include: {
      cache: {
        select: {
          emailDomain: true,
          emailDomainConfidence: true,
          emailPattern: true,
          patternConfidence: true
        }
      }
    }
  });
}

/** Repair the user-owned people behind Search History, in bounded batches. */
async function repairProspectPeople(
  options: Options,
  resolver: PersonIdentityResolverPort | null
): Promise<IdentityRepairStats> {
  const stats = emptyRepairStats();
  const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
  let cursor: string | null = null;

  for (;;) {
    const people = await fetchProspectPeopleBatch(cursor);
    if (people.length === 0) {
      break;
    }
    cursor = people[people.length - 1].id;

    for (const person of people) {
      try {
        const format: RepairableEmailFormat = {
          emailDomain: person.company.emailDomain,
          emailDomainConfidence: person.company.emailDomainConfidence,
          emailPattern: person.company.emailPattern,
          patternConfidence: person.company.patternConfidence
        };

        let candidate = person;
        if (resolver) {
          const resolved = await resolveIdentity(resolver, person, {
            name: person.company.officialName ?? person.company.name,
            domain: person.company.emailDomain
          });
          if (resolved) {
            stats.aiResolved += 1;
            candidate = { ...person, firstName: resolved.firstName, lastName: resolved.lastName, fullName: `${resolved.firstName} ${resolved.lastName}` };
          } else {
            stats.aiUnavailable += 1;
          }
        }

        const plan = planPersonIdentityRepair(candidate, format, { allowLowConfidence });
        recordRepairPlan(stats, plan);

        if (plan.changed && options.apply) {
          await prisma.prospectPerson.update({ where: { id: person.id }, data: plan.fields });
        }
      } catch {
        stats.failures += 1;
      }
    }
  }

  return stats;
}

/** Repair the shared cross-user cache pool so materialization stays clean. */
async function repairCachePeople(options: Options): Promise<IdentityRepairStats> {
  const stats = emptyRepairStats();
  const allowLowConfidence = env.PROSPECT_ALLOW_LOW_CONFIDENCE_EMAILS;
  let cursor: string | null = null;

  for (;;) {
    const people = await fetchCachePeopleBatch(cursor);
    if (people.length === 0) {
      break;
    }
    cursor = people[people.length - 1].id;

    for (const person of people) {
      try {
        // The shared entry's evidence-backed format — never a user override.
        const plan = planPersonIdentityRepair(person, person.cache, { allowLowConfidence });
        recordRepairPlan(stats, plan);

        if (plan.changed && options.apply) {
          await prisma.discoverSearchCachePerson.update({ where: { id: person.id }, data: plan.fields });
        }
      } catch {
        stats.failures += 1;
      }
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.info(`[repair-discover-person-identities] mode=${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.info(`[repair-discover-person-identities] target ${databaseFingerprint()}`);
  if (options.resolveIdentities) {
    console.info("[repair-discover-person-identities] ambiguous-name AI resolution: ENABLED");
  }

  // The AI fallback costs money, so it only ever runs on an explicit --apply.
  const resolver =
    options.resolveIdentities && options.apply ? new OpenAIPersonIdentityResolver() : null;

  const peopleStats = await repairProspectPeople(options, resolver);
  const cacheStats = await repairCachePeople(options);

  printStats("ProspectPerson", peopleStats);
  printStats("DiscoverSearchCachePerson", cacheStats);

  const total = emptyRepairStats();
  mergeStats(total, peopleStats);
  mergeStats(total, cacheStats);
  printStats("TOTAL", total);
  console.info(`  cacheRowsFixed: ${cacheStats.rowsScanned - cacheStats.unchanged}`);

  if (!options.apply) {
    console.info("\nDry run complete. No rows were written. Re-run with --apply to repair.");
  }
}

main()
  .catch((error) => {
    // Never echo the error body: it can carry row values or a connection string.
    console.error("[repair-discover-person-identities] failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
