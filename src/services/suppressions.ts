import { prisma } from "@/lib/db";

export type SuppressionReason = "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT" | "INVALID_EMAIL" | "MANUAL_BLOCK";

function normalizeSuppressionEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function listSuppressions(userId: string) {
  return prisma.suppression.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function suppressEmail(userId: string, email: string, reason: SuppressionReason, source: string, notes?: string) {
  const normalizedEmail = normalizeSuppressionEmail(email);

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
      notes: notes?.trim() ? notes.trim() : null
    },
    create: {
      userId,
      email: normalizedEmail,
      reason,
      source,
      notes: notes?.trim() ? notes.trim() : null
    }
  });
}

export async function deleteSuppression(userId: string, suppressionId: string) {
  const suppression = await prisma.suppression.findFirst({
    where: {
      id: suppressionId,
      userId
    }
  });

  if (!suppression) {
    return null;
  }

  await prisma.suppression.delete({
    where: {
      id: suppression.id
    }
  });

  return suppression;
}

export async function getSuppressedEmailSet(userId: string) {
  const suppressions = await prisma.suppression.findMany({
    where: { userId },
    select: { email: true }
  });
  return new Set(suppressions.map((entry) => entry.email));
}
