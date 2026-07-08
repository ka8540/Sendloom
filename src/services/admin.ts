import { prisma } from "@/lib/db";
import { isAdminUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { deleteObject } from "@/lib/storage";

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
      adultVerifiedAt: true,
      termsAcceptedAt: true,
      privacyAcceptedAt: true,
      antiAbuseAcceptedAt: true,
      policyVersion: true,
      ageGateVersion: true,
      eligibilityBlockedAt: true,
      eligibilityBlockedReason: true,
      restrictedAt: true,
      restrictedReason: true,
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

  return users.map((user) => {
    const hasTrackedSessionData = Boolean(user.lastLoginAt || user.lastSeenAt || user.sessionExpiresAt);
    const isLoggedIn = Boolean(user.sessionExpiresAt && user.sessionExpiresAt > now);

    return {
      id: user.id,
      email: user.email,
      isAdmin: isAdminUser(user),
      apiAccessDisabled: user.apiAccessDisabled,
      importsWriteDisabled: user.importsWriteDisabled,
      templatesWriteDisabled: user.templatesWriteDisabled,
      launchesDisabled: user.launchesDisabled,
      aiEnhancementsDisabled: user.aiEnhancementsDisabled,
      adultVerifiedAt: user.adultVerifiedAt?.toISOString() ?? null,
      termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
      privacyAcceptedAt: user.privacyAcceptedAt?.toISOString() ?? null,
      antiAbuseAcceptedAt: user.antiAbuseAcceptedAt?.toISOString() ?? null,
      policyVersion: user.policyVersion ?? null,
      ageGateVersion: user.ageGateVersion ?? null,
      eligibilityBlockedAt: user.eligibilityBlockedAt?.toISOString() ?? null,
      eligibilityBlockedReason: user.eligibilityBlockedReason ?? null,
      restrictedAt: user.restrictedAt?.toISOString() ?? null,
      restrictedReason: user.restrictedReason ?? null,
      isVerified: Boolean(
        user.adultVerifiedAt &&
        user.termsAcceptedAt &&
        user.privacyAcceptedAt &&
        user.antiAbuseAcceptedAt
      ),
      hasPasswordLogin: Boolean(user.passwordHash),
      authProvider: user.passwordHash ? "Password" : "Google",
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      sessionExpiresAt: user.sessionExpiresAt?.toISOString() ?? null,
      isLoggedIn,
      sessionStatus: isLoggedIn ? "active" : hasTrackedSessionData ? "signed_out" : "untracked",
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      counts: user._count
    };
  });
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

  await recordAuditEvent({
    actor: { id: args.actorUserId, email: args.actorEmail },
    action: args.revokeSession ? "admin.user.update_and_revoke_session" : "admin.user.update_controls",
    category: "ADMIN",
    severity: "WARNING",
    target: { type: "user", id: updatedUser.id, name: updatedUser.email },
    message: args.revokeSession
      ? `Updated restrictions and revoked sessions for ${updatedUser.email}.`
      : `Updated account restrictions for ${updatedUser.email}.`,
    metadata: {
      apiAccessDisabled: updatedUser.apiAccessDisabled,
      importsWriteDisabled: updatedUser.importsWriteDisabled,
      templatesWriteDisabled: updatedUser.templatesWriteDisabled,
      launchesDisabled: updatedUser.launchesDisabled,
      aiEnhancementsDisabled: updatedUser.aiEnhancementsDisabled,
      sessionRevoked: Boolean(args.revokeSession)
    },
    critical: true
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

  const importKeys = getUniqueFilePaths(
    targetUser.imports.map((entry) => entry.storagePath).filter((value): value is string => Boolean(value))
  );
  // Deduped attachment assets are shared only within this user's account, so
  // deleting every key on account wipe is safe. The asset table also covers
  // objects whose snapshot references were edited away.
  const attachmentAssets = await prisma.attachmentAsset.findMany({
    where: { userId: targetUser.id },
    select: { storageKey: true }
  });
  const attachmentKeys = getUniqueFilePaths([
    ...targetUser.campaigns.flatMap((campaign) => extractAttachmentPaths(campaign.templateSnapshot)),
    ...attachmentAssets.map((asset) => asset.storageKey)
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
      where: {
        OR: [{ actorEmail: targetUser.email }, { actorUserId: targetUser.id }]
      }
    });

    await tx.user.delete({
      where: { id: targetUser.id }
    });
  });

  await Promise.all([
    ...importKeys.map((storageKey) => deleteObject("imports", storageKey).catch(() => undefined)),
    ...attachmentKeys.map((storageKey) => deleteObject("attachments", storageKey).catch(() => undefined))
  ]);

  await recordAuditEvent({
    actor: { id: args.actorUserId, email: args.actorEmail },
    action: "admin.user.delete_all_data",
    category: "ADMIN",
    severity: "SECURITY",
    target: { type: "user", id: targetUser.id, name: targetUser.email },
    message: `Wiped all account data for ${targetUser.email}.`,
    metadata: {
      deletedCounts: targetUser._count,
      deletedFiles: importKeys.length + attachmentKeys.length
    },
    critical: true
  });

  return {
    id: targetUser.id,
    email: targetUser.email,
    deleted: true
  };
}

export async function restrictUserAccount(args: {
  actorEmail: string;
  actorUserId: string;
  userId: string;
  reason: string;
}) {
  const targetUser = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, email: true, isAdmin: true }
  });

  if (!targetUser) {
    throw new AdminActionError("User not found.", 404);
  }

  if (targetUser.id === args.actorUserId) {
    throw new AdminActionError("You cannot restrict your own account.", 403);
  }

  if (isAdminUser(targetUser)) {
    throw new AdminActionError("Admin accounts cannot be restricted from this dashboard.", 403);
  }

  const now = new Date();
  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      restrictedAt: now,
      restrictedReason: args.reason || "Restricted by administrator."
    },
    select: {
      id: true,
      email: true,
      restrictedAt: true,
      restrictedReason: true
    }
  });

  await recordAuditEvent({
    actor: { id: args.actorUserId, email: args.actorEmail },
    action: "admin.user.restricted",
    category: "ADMIN",
    severity: "WARNING",
    target: { type: "user", id: updatedUser.id, name: updatedUser.email },
    message: `Restricted account ${updatedUser.email}: ${args.reason}`,
    metadata: { reason: args.reason },
    critical: true
  });

  return updatedUser;
}

export async function unrestrictUserAccount(args: {
  actorEmail: string;
  actorUserId: string;
  userId: string;
}) {
  const targetUser = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, email: true, isAdmin: true }
  });

  if (!targetUser) {
    throw new AdminActionError("User not found.", 404);
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      restrictedAt: null,
      restrictedReason: null
    },
    select: {
      id: true,
      email: true,
      restrictedAt: true,
      restrictedReason: true
    }
  });

  await recordAuditEvent({
    actor: { id: args.actorUserId, email: args.actorEmail },
    action: "admin.user.unrestricted",
    category: "ADMIN",
    severity: "WARNING",
    target: { type: "user", id: updatedUser.id, name: updatedUser.email },
    message: `Removed restriction from ${updatedUser.email}.`,
    critical: true
  });

  return updatedUser;
}
