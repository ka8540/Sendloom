import { prisma } from "@/lib/db";
import {
  type AccountOverview,
  type AccountSenderView,
  type SenderRemovalReason,
  SENDER_ACTIVE_CAMPAIGN_STATUSES,
  SENDER_ACTIVE_RUN_STATUSES,
  deriveAccountType,
  getSenderConnectionStatus,
  getSenderProviderLabel
} from "@/lib/account";

type AccountUser = {
  email: string;
  passwordHash: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
};

type SenderRow = {
  id: string;
  name: string;
  fromEmail: string;
  provider: string;
  oauthRefreshToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Map a raw sender row to the client-safe view. The refresh token is read only
// to compute the connection status — it is never placed on the returned view.
export function serializeAccountSender(sender: SenderRow): AccountSenderView {
  return {
    id: sender.id,
    name: sender.name,
    fromEmail: sender.fromEmail,
    provider: sender.provider,
    providerLabel: getSenderProviderLabel(sender.provider),
    status: getSenderConnectionStatus(sender),
    connectedAt: sender.createdAt.toISOString(),
    updatedAt: sender.updatedAt.toISOString()
  };
}

// Build the account overview payload for the page/API. The password hash never
// leaves this function — only the boolean `hasPassword` derived from it does.
export async function getAccountOverview(userId: string, user: AccountUser): Promise<AccountOverview> {
  const senders = await prisma.senderProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      fromEmail: true,
      provider: true,
      oauthRefreshToken: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const hasPassword = Boolean(user.passwordHash);

  return {
    profile: {
      email: user.email,
      name: null,
      accountType: deriveAccountType(hasPassword),
      hasPassword,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null
    },
    senders: senders.map(serializeAccountSender),
    canRemoveSenders: senders.length > 1
  };
}

export type RemoveSenderResult =
  | { ok: true; mode: "deleted" | "disconnected"; fromEmail: string }
  | { ok: false; reason: SenderRemovalReason };

/**
 * Remove a connected sender for a user, enforcing every safety rule server-side
 * (never trusting the disabled frontend button):
 *   1. The sender must belong to the authenticated user (no cross-user removal).
 *   2. The user must keep at least one sender — the only sender is never removed.
 *   3. Senders wired to active/scheduled sequences are blocked, not orphaned.
 *
 * Then it removes the sender by the safest available path:
 *   - Hard-delete only when NO sequence references it (InboundReply cascades).
 *   - Otherwise detach it from the user and revoke send access (clear the
 *     refresh token). The row + campaign snapshots stay intact so historical
 *     sequences keep working and referential integrity is preserved.
 *
 * Runs inside a transaction so the count/relation checks and the mutation are
 * consistent.
 */
export async function removeUserSender(userId: string, senderProfileId: string): Promise<RemoveSenderResult> {
  return prisma.$transaction<RemoveSenderResult>(async (tx) => {
    const sender = await tx.senderProfile.findFirst({
      where: { id: senderProfileId, userId },
      select: { id: true, fromEmail: true }
    });

    if (!sender) {
      return { ok: false, reason: "not_found" };
    }

    const senderCount = await tx.senderProfile.count({ where: { userId } });
    if (senderCount <= 1) {
      return { ok: false, reason: "only_sender" };
    }

    const activeCampaignCount = await tx.campaign.count({
      where: {
        senderProfileId,
        OR: [
          { status: { in: [...SENDER_ACTIVE_CAMPAIGN_STATUSES] } },
          { runs: { some: { status: { in: [...SENDER_ACTIVE_RUN_STATUSES] } } } }
        ]
      }
    });
    if (activeCampaignCount > 0) {
      return { ok: false, reason: "active_campaigns" };
    }

    const totalCampaignCount = await tx.campaign.count({ where: { senderProfileId } });
    if (totalCampaignCount === 0) {
      // No sequence references this sender — a hard delete is safe. The only
      // other relation (InboundReply) is ON DELETE CASCADE.
      await tx.senderProfile.delete({ where: { id: senderProfileId } });
      return { ok: true, mode: "deleted", fromEmail: sender.fromEmail };
    }

    // Historical sequences reference this sender (the Campaign FK is Restrict).
    // Detach it from the user and revoke send access so it disappears from the
    // account while old sequences keep their sender row + snapshot intact.
    await tx.senderProfile.update({
      where: { id: senderProfileId },
      data: { userId: null, oauthRefreshToken: null }
    });
    return { ok: true, mode: "disconnected", fromEmail: sender.fromEmail };
  });
}
