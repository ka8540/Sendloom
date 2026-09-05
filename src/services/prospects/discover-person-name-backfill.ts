import { shouldRegenerateProspectEmail } from "@/services/prospects/prospect-person-email";
import { overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import type { PrismaClient } from "@prisma/client";
import { planDiscoverNameRepairs, emptyNameRepairStats } from "@/services/prospects/discover-person-name-repair";
import type { NormalizationOptions } from "@/services/prospects/discover-person-name-normalization";

export type BackfillOptions = { apply: boolean; batchSize: number; limit: number; afterPerson?: string; afterCache?: string; retryFallback?: boolean };
export function parseNameRepairArgs(args: string[]): BackfillOptions {
  const value = (flag: string, fallback: number, max: number) => {
    const index = args.indexOf(flag);
    const n = index < 0 ? fallback : Number(args[index + 1]);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error("invalid_arguments");
    return n;
  };
  const allowed = new Set(["--apply", "--dry-run", "--batch-size", "--limit", "--after-person", "--after-cache", "--retry-fallback"]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error("invalid_arguments");
    if (["--batch-size", "--limit", "--after-person", "--after-cache"].includes(args[i])) {
      if (!args[++i] || args[i].startsWith("--")) throw new Error("invalid_arguments");
    }
  }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("invalid_arguments");
  const cursor = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  return { apply: args.includes("--apply"), batchSize: value("--batch-size", 50, 200), limit: value("--limit", 1000, 100000),
    afterPerson: cursor("--after-person"), afterCache: cursor("--after-cache"), retryFallback: args.includes("--retry-fallback") };
}

/** Bounded per-store keyset traversal. No Apify, search allocation or quota writes. */
export async function repairDiscoverPersonNames(db: PrismaClient, options: BackfillOptions, normalization: NormalizationOptions = {}) {
  const total = emptyNameRepairStats();
  for (const store of ["person", "cache"] as const) {
    let cursor = store === "person" ? options.afterPerson : options.afterCache;
    let remaining = options.limit;
    while (remaining > 0) {
      const query = { take: Math.min(remaining, options.batchSize), where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" as const } };
      const rows = store === "person"
        ? await db.prospectPerson.findMany({ ...query, include: { company: true } })
        : await db.discoverSearchCachePerson.findMany({ ...query, include: { cache: true } });
      if (!rows.length) break;
      const contextualRows = rows.map(p => ({ ...p, currentCompanyName: "company" in p ? p.company.officialName ?? p.company.name : p.cache.companyName }));
      const { plans, stats } = await planDiscoverNameRepairs(contextualRows, p => "company" in p ? p.company : p.cache,
        { ...normalization, retryFallback: options.retryFallback });
      // Respect the requesting owner's terminal address overlay as well as the
      // persisted status. Never replace or reintroduce a suppressed address.
      if (store === "person") {
        for (const plan of plans) {
          if (!("userId" in plan.original)) continue;
          const original = plan.original;
          if (!shouldRegenerateProspectEmail(original)) continue;
          const emails = [original.inferredEmail, plan.fields.inferredEmail].filter((e): e is string => Boolean(e)).map(e => e.trim().toLowerCase());
          const suppressed = emails.length ? await db.suppression.findMany({ where: { userId: original.userId, email: { in: emails } }, select: { email: true, reason: true } }) : [];
          if (suppressed.length) {
            const oldBlocked = suppressed.find(s => s.email.toLowerCase() === original.inferredEmail?.toLowerCase());
            if (oldBlocked) {
              if (plan.fields.inferredEmail !== original.inferredEmail) stats[plan.fields.inferredEmail ? "emailsRegenerated" : "emailsCleared"]--;
              for (const key of ["inferredEmail", "emailStatus", "emailConfidence", "emailPattern", "emailSource"] as const) plan.fields[key] = original[key] as never;
              plan.fields.emailStatus = overlayEmailCandidateStatus(original.emailStatus, oldBlocked.reason);
            } else {
              plan.fields.emailStatus = overlayEmailCandidateStatus(plan.fields.emailStatus, suppressed[0].reason);
            }
            const changed = Object.entries(plan.fields).some(([k, v]) => (original[k as keyof typeof original] ?? null) !== v);
            if (plan.changed && !changed) { stats.changed--; stats.unchanged++; }
            if (!plan.changed && changed) { stats.changed++; stats.unchanged--; }
            plan.changed = changed;
          }
        }
      }
      if (options.apply) for (const plan of plans) {
        if (!plan.changed) continue;
        const where = { id: plan.original.id, updatedAt: plan.original.updatedAt };
        // Optimistic comparison protects a concurrent verification or newer name.
        const update = store === "person"
          ? await db.prospectPerson.updateMany({ where, data: plan.fields })
          : await db.discoverSearchCachePerson.updateMany({ where, data: plan.fields });
        if (update.count !== 1) stats.writeConflicts++;
      }
      for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += stats[key];
      remaining -= rows.length;
      cursor = rows.at(-1)!.id;
    }
  }
  return total;
}
