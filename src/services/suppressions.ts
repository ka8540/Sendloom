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

/**
 * Record that a recipient ADDRESS was rejected as invalid (synchronous Gmail
 * send rejection, or a reclassified historical failure). Idempotent per
 * address: repeated detections only bump the failure counters. An existing
 * UNSUBSCRIBED record keeps its reason (unsubscribes are never relabelled),
 * and a confirmed HARD_BOUNCE keeps the stronger DSN-backed reason — only the
 * failure detail is refreshed.
 */
export async function recordInvalidRecipientSuppression(args: {
  userId: string;
  email: string;
  source: string;
  failureCategory?: string | null;
  enhancedStatusCode?: string | null;
  occurredAt?: Date;
}) {
  const email = normalizeSuppressionEmail(args.email);
  const occurredAt = args.occurredAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.suppression.findUnique({
      where: { userId_email: { userId: args.userId, email } }
    });

    const failureDetail = {
      failureCategory: args.failureCategory ?? null,
      enhancedStatusCode: args.enhancedStatusCode ?? null,
      lastFailedAt: occurredAt
    };

    if (existing) {
      const keepReason = existing.reason === "UNSUBSCRIBED" || existing.reason === "HARD_BOUNCE";
      return tx.suppression.update({
        where: { id: existing.id },
        data: {
          ...failureDetail,
          reason: keepReason ? existing.reason : "INVALID_EMAIL",
          source: keepReason ? existing.source : args.source,
          firstFailedAt: existing.firstFailedAt ?? occurredAt,
          failureCount: { increment: 1 }
        }
      });
    }

    return tx.suppression.create({
      data: {
        userId: args.userId,
        email,
        reason: "INVALID_EMAIL",
        source: args.source,
        ...failureDetail,
        firstFailedAt: occurredAt,
        failureCount: 1
      }
    });
  });
}

export async function getSuppressedEmailSet(userId: string) {
  const suppressions = await prisma.suppression.findMany({
    where: { userId },
    select: { email: true }
  });
  return new Set(suppressions.map((entry) => entry.email));
}
