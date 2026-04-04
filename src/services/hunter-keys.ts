import { prisma } from "@/lib/db";
import { decryptHunterApiKey, encryptHunterApiKey, maskHunterApiKey } from "@/lib/hunter-crypto";

export async function getHunterKeyStatusForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      hunterApiKeyEncrypted: true,
      hunterApiKeyLast4: true,
      hunterApiKeyUpdatedAt: true
    }
  });

  return {
    configured: Boolean(user.hunterApiKeyEncrypted),
    last4: user.hunterApiKeyLast4 ?? null,
    updatedAt: user.hunterApiKeyUpdatedAt?.toISOString() ?? null
  };
}

export async function saveHunterKeyForUser(userId: string, apiKey: string) {
  const trimmed = apiKey.trim();
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      hunterApiKeyEncrypted: encryptHunterApiKey(trimmed),
      hunterApiKeyLast4: maskHunterApiKey(trimmed),
      hunterApiKeyUpdatedAt: new Date()
    },
    select: {
      hunterApiKeyLast4: true,
      hunterApiKeyUpdatedAt: true
    }
  });

  return {
    configured: true,
    last4: updatedUser.hunterApiKeyLast4 ?? null,
    updatedAt: updatedUser.hunterApiKeyUpdatedAt?.toISOString() ?? null
  };
}

export async function getDecryptedHunterKeyForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      hunterApiKeyEncrypted: true
    }
  });

  if (!user.hunterApiKeyEncrypted) {
    return null;
  }

  return decryptHunterApiKey(user.hunterApiKeyEncrypted);
}
