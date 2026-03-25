import { prisma } from "@/lib/db";

type SuppressionReason = "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT" | "INVALID_EMAIL" | "MANUAL_BLOCK";

export async function listSuppressions(userId: string) {
  return prisma.suppression.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function suppressEmail(userId: string, email: string, reason: SuppressionReason, source: string, notes?: string) {
  const normalizedEmail = email.toLowerCase();

  return prisma.suppression.upsert({
    where: {
      userId_email: {
        userId,
        email: normalizedEmail
      }
    },
    update: {
      reason,
      source,
      notes
    },
    create: {
      userId,
      email: normalizedEmail,
      reason,
      source,
      notes
    }
  });
}

export async function getSuppressedEmailSet(userId: string) {
  const suppressions = await prisma.suppression.findMany({
    where: { userId },
    select: { email: true }
  });
  return new Set(suppressions.map((entry) => entry.email));
}
