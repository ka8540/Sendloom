import { prisma } from "@/lib/db";

type GoogleSenderInput = {
  userId: string;
  accountId: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  refreshToken?: string;
  scope?: string;
};

export async function upsertGoogleSender(input: GoogleSenderInput) {
  const existing = await prisma.senderProfile.findUnique({
    where: { fromEmail: input.email }
  });

  if (existing && existing.userId && existing.userId !== input.userId) {
    throw new Error("This Gmail account is already connected to another Sendloom user.");
  }

  const refreshToken = input.refreshToken ?? existing?.oauthRefreshToken ?? null;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Reconnect the Gmail account with consent and try again.");
  }

  return prisma.senderProfile.upsert({
    where: { fromEmail: input.email },
    update: {
      userId: input.userId,
      name: input.name || input.email,
      provider: "google_oauth",
      providerRef: input.accountId,
      oauthRefreshToken: refreshToken,
      oauthScope: input.scope ?? existing?.oauthScope ?? null,
      metadata: {
        picture: input.picture ?? null
      }
    },
    create: {
      userId: input.userId,
      name: input.name || input.email,
      fromEmail: input.email,
      provider: "google_oauth",
      providerRef: input.accountId,
      oauthRefreshToken: refreshToken,
      oauthScope: input.scope ?? null,
      metadata: {
        picture: input.picture ?? null
      }
    }
  });
}

export async function listUserSenders(userId: string) {
  return prisma.senderProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });
}

export async function getDefaultUserSender(userId: string) {
  return prisma.senderProfile.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
}

export async function markSenderRequiresReconnect(senderProfileId: string) {
  return prisma.senderProfile.update({
    where: { id: senderProfileId },
    data: {
      oauthRefreshToken: null
    }
  });
}
