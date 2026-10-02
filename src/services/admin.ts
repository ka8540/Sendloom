import { prisma } from "@/lib/db";
import { isAdminUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";

export class AdminActionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminActionError";
    this.status = status;
  }
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

  if (targetUser.id === args.actorUserId || isAdminUser(targetUser)) {
    throw new AdminActionError("Admin and self accounts cannot be changed from this dashboard.", 403);
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
