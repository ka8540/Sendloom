import { overlayEmailCandidateStatus } from "@/lib/prospect-enums";
import { shouldRegenerateProspectEmail } from "@/services/prospects/prospect-person-email";
import { normalizeDiscoverPersonNames, type NormalizationOptions } from "@/services/prospects/discover-person-name-normalization";
import { type DiscoverNameInput, nameStateFields, readNameStamp, isPlainDiscoverName } from "@/services/prospects/discover-name-contract";
import { resolveProspectPersonEmail, type ProspectCompanyEmailInput, type ProspectPersonEmailInput } from "@/services/prospects/prospect-person-email";

export type NamedEmailPerson = DiscoverNameInput & ProspectPersonEmailInput;
export async function normalizeDiscoverPeopleWithEmails<T extends NamedEmailPerson>(people: T[], format: ProspectCompanyEmailInput, options: NormalizationOptions = {}) {
  const normalized = await normalizeDiscoverPersonNames(people, options);
  return normalized.map(p => ({ ...p, ...resolveProspectPersonEmail(p, format, { allowLowConfidence: false, regenerateExistingInferred: true }) }));
}
export function repairedPersonFields(person: NamedEmailPerson) {
  return { firstName: person.firstName, lastName: person.lastName, fullName: person.fullName, ...nameStateFields(person),
    inferredEmail: person.inferredEmail, emailStatus: person.emailStatus, emailConfidence: person.emailConfidence,
    emailPattern: person.emailPattern, emailSource: person.emailSource };
}
export type RepairStats = { scanned: number; suspicious: number; requiringAI: number; changed: number; unchanged: number; emailsRegenerated: number; emailsCleared: number; unsafe: number; writeConflicts: number };
export const emptyNameRepairStats = (): RepairStats => ({ scanned: 0, suspicious: 0, requiringAI: 0, changed: 0, unchanged: 0, emailsRegenerated: 0, emailsCleared: 0, unsafe: 0, writeConflicts: 0 });
/** Shared planning seam: dry-run and apply compute exactly the same corrections. */
export async function planDiscoverNameRepairs<T extends NamedEmailPerson>(people: T[], format: (p: T) => ProspectCompanyEmailInput, options: NormalizationOptions = {}) {
  const names = await normalizeDiscoverPersonNames(people, options);
  const stats = emptyNameRepairStats();
  const plans = people.map((original, i) => {
    const person = names[i];
    const nameChanged = person.firstName !== original.firstName || person.lastName !== original.lastName || person.fullName !== original.fullName;
    const refreshEmail = nameChanged || !readNameStamp(person)?.canGenerateEmail;
    const emailFields = refreshEmail
      ? resolveProspectPersonEmail(person, format(original), { allowLowConfidence: false, regenerateExistingInferred: true })
      : { inferredEmail: original.inferredEmail, emailStatus: original.emailStatus, emailConfidence: original.emailConfidence,
          emailPattern: original.emailPattern, emailSource: original.emailSource };
    const fields = repairedPersonFields({ ...person, ...emailFields });
    const changed = Object.entries(fields).some(([key, value]) => (original[key as keyof T] ?? null) !== value);
    stats.scanned++;
    if (!isPlainDiscoverName(original.sourceName ?? original.fullName)) { stats.suspicious++; if (!readNameStamp(original)) stats.requiringAI++; }
    stats[changed ? "changed" : "unchanged"]++;
    if (!readNameStamp(person)?.canGenerateEmail) stats.unsafe++;
    if (fields.inferredEmail !== original.inferredEmail) stats[fields.inferredEmail ? "emailsRegenerated" : "emailsCleared"]++;
    return { original, fields, changed };
  });
  return { plans, stats };
}

/** Name correction is not permission to revive a previously blocked address. */
export async function protectNameRepairSuppressions<T extends NamedEmailPerson>(
  db: Pick<import("@prisma/client").PrismaClient, "suppression">,
  userId: string,
  originals: NamedEmailPerson[],
  corrected: T[]
): Promise<T[]> {
  const key = (email: string | null) => email?.trim().toLowerCase() ?? "";
  const emails = [...new Set([...originals, ...corrected].map(p => key(p.inferredEmail)).filter(Boolean))];
  if (!emails.length) return corrected;
  const blocked = await db.suppression.findMany({ where: { userId, email: { in: emails } }, select: { email: true, reason: true } });
  const byEmail = new Map(blocked.map(p => [key(p.email), p.reason]));
  return corrected.map((p, i) => {
    const original = originals[i];
    if (!shouldRegenerateProspectEmail(original)) return p;
    const oldReason = byEmail.get(key(original.inferredEmail));
    if (oldReason) return { ...p, inferredEmail: original.inferredEmail,
      emailStatus: overlayEmailCandidateStatus(original.emailStatus, oldReason), emailConfidence: original.emailConfidence,
      emailPattern: original.emailPattern, emailSource: original.emailSource };
    const newReason = byEmail.get(key(p.inferredEmail));
    return newReason ? { ...p, emailStatus: overlayEmailCandidateStatus(p.emailStatus, newReason) } : p;
  });
}
