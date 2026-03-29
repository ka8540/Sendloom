import { unlink } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { isAdminUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export class AdminActionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminActionError";
    this.status = status;
  }
}

function extractAttachmentPaths(templateSnapshot: unknown) {
  if (!templateSnapshot || typeof templateSnapshot !== "object" || Array.isArray(templateSnapshot)) {
    return [] as string[];
  }

  const attachments = (templateSnapshot as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) {
    return [] as string[];
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
        return null;
      }

      const storagePath = (attachment as { storagePath?: unknown }).storagePath;
      return typeof storagePath === "string" && storagePath.length > 0 ? storagePath : null;
    })
    .filter((value): value is string => Boolean(value));
}

function getUniqueFilePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

export async function listAdminUsers() {
  const now = new Date();
  const users = await prisma.user.findMany({
    orderBy: [{ isAdmin: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      isAdmin: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      passwordHash: true,
      lastLoginAt: true,
      lastSeenAt: true,
      sessionExpiresAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          imports: true,
          mappings: true,
          templates: true,
          campaigns: true,
          senderProfiles: true,
          suppressions: true
        }
      }
    }
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    isAdmin: isAdminUser(user),
    apiAccessDisabled: user.apiAccessDisabled,
    importsWriteDisabled: user.importsWriteDisabled,
    templatesWriteDisabled: user.templatesWriteDisabled,
    launchesDisabled: user.launchesDisabled,
    aiEnhancementsDisabled: user.aiEnhancementsDisabled,
    hasPasswordLogin: Boolean(user.passwordHash),
    authProvider: user.passwordHash ? "Password" : "Google",
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    sessionExpiresAt: user.sessionExpiresAt?.toISOString() ?? null,
    isLoggedIn: Boolean(user.sessionExpiresAt && user.sessionExpiresAt > now),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    counts: user._count
  }));
}

export async function updateUserAdminControls(args: {
  actorEmail: string;
  actorUserId: string;
  userId: string;
  apiAccessDisabled: boolean;
  importsWriteDisabled: boolean;
  templatesWriteDisabled: boolean;
  launchesDisabled: boolean;
  aiEnhancementsDisabled: boolean;
  revokeSession?: boolean;
}) {
  const targetUser = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      email: true,
      isAdmin: true
    }
  });

  if (!targetUser) {
    throw new AdminActionError("User not found.", 404);
  }

  if (targetUser.id === args.actorUserId) {
    throw new AdminActionError("For safety, modify another account from the admin dashboard instead of your own.", 403);
  }

  if (isAdminUser(targetUser)) {
    throw new AdminActionError("Admin accounts cannot be modified from this dashboard.", 403);
  }

  const now = new Date();
  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      apiAccessDisabled: args.apiAccessDisabled,
      importsWriteDisabled: args.importsWriteDisabled,
      templatesWriteDisabled: args.templatesWriteDisabled,
      launchesDisabled: args.launchesDisabled,
      aiEnhancementsDisabled: args.aiEnhancementsDisabled,
      ...(args.revokeSession
        ? {
            sessionIssuedAt: now,
            sessionExpiresAt: null
          }
        : {})
    },
    select: {
      id: true,
      email: true,
      apiAccessDisabled: true,
      importsWriteDisabled: true,
      templatesWriteDisabled: true,
      launchesDisabled: true,
      aiEnhancementsDisabled: true,
      sessionExpiresAt: true
    }
  });

  await writeAuditLog({
    actorEmail: args.actorEmail,
    action: args.revokeSession ? "admin.user.update_and_revoke_session" : "admin.user.update_controls",
    entityType: "user",
    entityId: updatedUser.id,
    metadata: {
      targetEmail: updatedUser.email,
      apiAccessDisabled: updatedUser.apiAccessDisabled,
      importsWriteDisabled: updatedUser.importsWriteDisabled,
      templatesWriteDisabled: updatedUser.templatesWriteDisabled,
      launchesDisabled: updatedUser.launchesDisabled,
      aiEnhancementsDisabled: updatedUser.aiEnhancementsDisabled,
      sessionRevoked: Boolean(args.revokeSession)
    }
  });

  return updatedUser;
}

export async function deleteUserAccountData(args: {
  actorEmail: string;
  actorUserId: string;
  userId: string;
}) {
  const targetUser = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      imports: {
        select: {
          id: true,
          storagePath: true
        }
      },
      campaigns: {
        select: {
          id: true,
          templateSnapshot: true
        }
      },
      _count: {
        select: {
          imports: true,
          mappings: true,
          templates: true,
          campaigns: true,
          senderProfiles: true,
          suppressions: true
        }
      }
    }
  });

  if (!targetUser) {
    throw new AdminActionError("User not found.", 404);
  }

  if (targetUser.id === args.actorUserId) {
    throw new AdminActionError("For safety, self-deletion is blocked from the admin dashboard.", 403);
  }

  if (isAdminUser(targetUser)) {
    throw new AdminActionError("Admin accounts cannot be deleted from this dashboard.", 403);
  }

  const filePaths = getUniqueFilePaths([
    ...targetUser.imports.map((entry) => entry.storagePath).filter((value): value is string => Boolean(value)),
    ...targetUser.campaigns.flatMap((campaign) => extractAttachmentPaths(campaign.templateSnapshot))
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.campaign.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.mapping.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.template.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.import.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.suppression.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.senderProfile.deleteMany({
      where: { userId: targetUser.id }
    });

    await tx.auditLog.deleteMany({
      where: { actorEmail: targetUser.email }
    });

    await tx.user.delete({
      where: { id: targetUser.id }
    });
  });

  if (!process.env.VERCEL) {
    await Promise.all(filePaths.map((path) => unlink(path).catch(() => undefined)));
  }

  await writeAuditLog({
    actorEmail: args.actorEmail,
    action: "admin.user.delete_all_data",
    entityType: "user",
    entityId: targetUser.id,
    metadata: {
      targetEmail: targetUser.email,
      deletedCounts: targetUser._count,
      deletedFiles: filePaths.length
    }
  });

  return {
    id: targetUser.id,
    email: targetUser.email,
    deleted: true
  };
}
