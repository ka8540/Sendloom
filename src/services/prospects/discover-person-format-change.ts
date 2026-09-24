import { overlayEmailCandidateStatus, type EmailCandidateStatus } from "@/lib/prospect-enums";
import {
  shouldRegenerateProspectEmail,
  type ProspectPersonEmailInput
} from "@/services/prospects/prospect-person-email";

type SuppressionReader = Pick<import("@prisma/client").PrismaClient, "suppression">;

const PERSON_SAFETY_REASONS = new Set(["UNSUBSCRIBED", "COMPLAINT", "MANUAL_BLOCK"]);
const USABLE_STATUSES = new Set<EmailCandidateStatus>([
  "VERIFIED",
  "INFERRED_HIGH",
  "INFERRED_MEDIUM",
  "INFERRED_LOW"
]);

export type EmailFormatRegenerationStats = {
  peopleScanned: number;
  peopleEligible: number;
  peopleRegenerated: number;
  emailsChanged: number;
  becameUsable: number;
  remainedInvalid: number;
  protectedUnsubscribed: number;
  protectedComplaint: number;
  protectedManualBlock: number;
};

export function emptyEmailFormatRegenerationStats(): EmailFormatRegenerationStats {
  return {
    peopleScanned: 0,
    peopleEligible: 0,
    peopleRegenerated: 0,
    emailsChanged: 0,
    becameUsable: 0,
    remainedInvalid: 0,
    protectedUnsubscribed: 0,
    protectedComplaint: 0,
    protectedManualBlock: 0
  };
}

export function addEmailFormatRegenerationStats(
  total: EmailFormatRegenerationStats,
  next: EmailFormatRegenerationStats
): EmailFormatRegenerationStats {
  return Object.fromEntries(
    Object.keys(total).map((key) => [
      key,
      total[key as keyof EmailFormatRegenerationStats] + next[key as keyof EmailFormatRegenerationStats]
    ])
  ) as EmailFormatRegenerationStats;
}

/**
 * Apply suppression policy specifically for a COMPANY FORMAT change.
 *
 * Address-quality suppressions (HARD_BOUNCE / INVALID_EMAIL) stay attached to
 * the old address and do not pin the person to it. The newly generated address
 * is persisted with its newly derived candidate status; live read-time lookup
 * decides whether that exact new address is also invalid.
 *
 * Person/outreach safety suppressions are different: a format edit must never
 * route around an unsubscribe, complaint, or manual block. Those people keep
 * their prior candidate so every existing send/export suppression guard still
 * resolves the safety record by the same address.
 */
export async function protectFormatChangeSuppressions<T extends ProspectPersonEmailInput>(
  db: SuppressionReader,
  userId: string,
  originals: T[],
  regenerated: T[]
): Promise<{ people: T[]; stats: EmailFormatRegenerationStats }> {
  const key = (email: string | null) => email?.trim().toLowerCase() ?? "";
  const emails = [...new Set([...originals, ...regenerated].map((person) => key(person.inferredEmail)).filter(Boolean))];
  const blocked = emails.length
    ? await db.suppression.findMany({
        where: { userId, email: { in: emails } },
        select: { email: true, reason: true }
      })
    : [];
  const reasonByEmail = new Map(blocked.map((row) => [key(row.email), row.reason]));
  const stats = emptyEmailFormatRegenerationStats();
  stats.peopleScanned = originals.length;

  const people = regenerated.map((candidate, index) => {
    const original = originals[index];
    if (!shouldRegenerateProspectEmail(original)) {
      return candidate;
    }

    stats.peopleEligible += 1;
    const oldReason = reasonByEmail.get(key(original.inferredEmail)) ?? null;
    if (oldReason && PERSON_SAFETY_REASONS.has(oldReason)) {
      if (oldReason === "UNSUBSCRIBED") stats.protectedUnsubscribed += 1;
      if (oldReason === "COMPLAINT") stats.protectedComplaint += 1;
      if (oldReason === "MANUAL_BLOCK") stats.protectedManualBlock += 1;
      return {
        ...candidate,
        inferredEmail: original.inferredEmail,
        emailStatus: overlayEmailCandidateStatus(original.emailStatus, oldReason),
        emailConfidence: original.emailConfidence,
        emailPattern: original.emailPattern,
        emailSource: original.emailSource
      };
    }

    stats.peopleRegenerated += 1;
    if (key(candidate.inferredEmail) !== key(original.inferredEmail)) {
      stats.emailsChanged += 1;
    }

    const newReason = reasonByEmail.get(key(candidate.inferredEmail)) ?? null;
    const oldStatus = overlayEmailCandidateStatus(original.emailStatus, oldReason);
    const newStatus = overlayEmailCandidateStatus(candidate.emailStatus, newReason);
    if (!USABLE_STATUSES.has(oldStatus) && USABLE_STATUSES.has(newStatus)) {
      stats.becameUsable += 1;
    }
    if (newStatus === "INVALID") {
      stats.remainedInvalid += 1;
    }

    // Intentionally do not persist the suppression overlay. The database row
    // owns the current candidate; suppression history owns address outcomes.
    return candidate;
  });

  return { people, stats };
}
