import { prisma } from "@/lib/db";
import { releaseSendReservation, type DailySendLimitScope } from "@/lib/daily-send-limit";
import { isMissingSendLedgerTableError, warnMissingSendLedgerTable } from "@/lib/send-ledger-table";

export type RecordSendArgs = {
  scope: DailySendLimitScope;
  reservationId?: string | null;
  campaignId?: string | null;
  campaignRunId?: string | null;
  recipientJobId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  kind?: "INITIAL" | "FOLLOW_UP";
  sentAt?: Date;
};

/**
 * Persist a confirmed Gmail send to the ledger (source of truth for the
 * rolling 24h window) and clear the Redis reservation that protected the
 * race window between "decide to send" and this write.
 *
 * Safe to call once per successful send only — retries that fail should
 * not write here, otherwise the rolling count over-reports.
 */
export async function recordSendOnLedger(args: RecordSendArgs) {
  const sentAt = args.sentAt ?? new Date();

  try {
    await prisma.sendLedger.create({
      data: {
        userId: args.scope.userId ?? null,
        senderProfileId: args.scope.senderProfileId ?? null,
        campaignId: args.campaignId ?? null,
        campaignRunId: args.campaignRunId ?? null,
        recipientJobId: args.recipientJobId ?? null,
        messageId: args.messageId ?? null,
        threadId: args.threadId ?? null,
        kind: args.kind ?? "INITIAL",
        sentAt
      }
    });
  } catch (error) {
    if (!isMissingSendLedgerTableError(error)) {
      throw error;
    }

    warnMissingSendLedgerTable();
    if (args.reservationId) {
      await releaseSendReservation(args.scope, args.reservationId);
    }
    return;
  }

  if (args.reservationId) {
    await releaseSendReservation(args.scope, args.reservationId);
  }
}
