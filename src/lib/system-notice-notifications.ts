import { randomUUID } from "node:crypto";

import {
  Prisma,
  SystemNoticeRecipientStatus,
  SystemNoticeStatus,
  type PrismaClient,
  type SystemNoticeType
} from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  resendSystemNoticeMailer,
  type SystemNoticeEmailInput,
  type SystemNoticeMailer
} from "@/lib/system-notice-email";

const RECIPIENT_LEASE_MS = 10 * 60 * 1000;
const MAX_RECIPIENT_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000, 12 * 60 * 60 * 1000];

export type SystemNoticeRecord = SystemNoticeEmailInput & {
  id: string;
  status: SystemNoticeStatus;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
  startedAt: Date | null;
};

export type ClaimedSystemNoticeRecipient = {
  id: string;
  noticeId: string;
  userId: string;
  emailSnapshot: string;
  attempts: number;
  leaseToken: string;
  previousStatus: SystemNoticeRecipientStatus;
  previousAttempts: number;
};

export type SystemNoticeStore = {
  listProcessable(now: Date): Promise<SystemNoticeRecord[]>;
  markSending(noticeId: string, now: Date): Promise<boolean>;
  materializeRecipientPage(noticeId: string, take: number, now: Date): Promise<{ created: number; complete: boolean }>;
  claimRecipients(
    noticeId: string,
    limit: number,
    now: Date,
    leaseExpiresAt: Date
  ): Promise<ClaimedSystemNoticeRecipient[]>;
  releaseUnattemptedClaims(recipients: ClaimedSystemNoticeRecipient[], now: Date): Promise<void>;
  markRecipientSent(recipient: ClaimedSystemNoticeRecipient, providerMessageId: string, now: Date): Promise<boolean>;
  markRecipientFailed(
    recipient: ClaimedSystemNoticeRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ): Promise<void>;
  markExhaustedRetriesPermanent(noticeId: string): Promise<number>;
  getProgress(noticeId: string): Promise<{ materialized: boolean; remaining: number; permanentFailures: number }>;
  markCompleted(noticeId: string, now: Date): Promise<boolean>;
};

type ProcessorAudit = (input: {
  action: "system_notice.delivery_started" | "system_notice.delivery_completed";
  notice: SystemNoticeRecord;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type SystemNoticeProcessorResult = {
  noticesDue: number;
  noticesStarted: number;
  noticesCompleted: number;
  recipientsMaterialized: number;
  recipientsSent: number;
  recipientsRemaining: number;
  failures: number;
  deliveryEnabled: boolean;
};

export function canDeliverSystemNotices(input: {
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
  processingEnabled: boolean;
}) {
  return (
    input.nodeEnv === "production" &&
    input.vercelEnv === "production" &&
    input.processingEnabled
  );
}

export type SystemNoticeAccountRecipientQuery = Prisma.UserFindManyArgs;

/** The operational audience is the account User table and nothing else. */
export function getSystemNoticeAccountRecipientPage(
  findMany: (args: SystemNoticeAccountRecipientQuery) => Promise<Array<{ id: string; email: string }>>,
  input: { cursor: string | null; take: number }
) {
  return findMany({
    select: { id: true, email: true },
    orderBy: { id: "asc" },
    take: input.take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {})
  });
}

function mapNotice(record: {
  id: string;
  type: SystemNoticeType;
  status: SystemNoticeStatus;
  subject: string;
  title: string;
  message: string;
  affectedArea: string | null;
  scheduledSendAt: Date | null;
  impactStartsAt: Date | null;
  impactEndsAt: Date | null;
  timeZone: string;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
  startedAt: Date | null;
}): SystemNoticeRecord {
  return record;
}

export function createPrismaSystemNoticeStore(client: PrismaClient): SystemNoticeStore {
  return {
    async listProcessable(now) {
      const notices = await client.systemNotice.findMany({
        where: {
          OR: [
            { status: SystemNoticeStatus.SCHEDULED, scheduledSendAt: { lte: now } },
            { status: SystemNoticeStatus.SENDING }
          ]
        },
        orderBy: [{ scheduledSendAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 20,
        select: {
          id: true,
          type: true,
          status: true,
          subject: true,
          title: true,
          message: true,
          affectedArea: true,
          scheduledSendAt: true,
          impactStartsAt: true,
          impactEndsAt: true,
          timeZone: true,
          recipientCursor: true,
          recipientsMaterializedAt: true,
          startedAt: true
        }
      });
      return notices.map(mapNotice);
    },

    async markSending(noticeId, now) {
      const updated = await client.systemNotice.updateMany({
        where: {
          id: noticeId,
          status: SystemNoticeStatus.SCHEDULED,
          scheduledSendAt: { lte: now },
          cancelledAt: null,
          startedAt: null
        },
        data: { status: SystemNoticeStatus.SENDING, startedAt: now, lastErrorCode: null }
      });
      return updated.count === 1;
    },

    async materializeRecipientPage(noticeId, take, now) {
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            status: SystemNoticeStatus;
            recipientCursor: string | null;
            recipientsMaterializedAt: Date | null;
          }>
        >(Prisma.sql`
          SELECT "status", "recipientCursor", "recipientsMaterializedAt"
          FROM "SystemNotice"
          WHERE "id" = ${noticeId}
          FOR UPDATE
        `);
        const notice = rows[0];
        if (
          !notice ||
          notice.status !== SystemNoticeStatus.SENDING ||
          notice.recipientsMaterializedAt
        ) {
          return { created: 0, complete: true };
        }

        const users = await getSystemNoticeAccountRecipientPage(
          (args) => tx.user.findMany(args) as Promise<Array<{ id: string; email: string }>>,
          { cursor: notice.recipientCursor, take }
        );
        const created = users.length
          ? (
              await tx.systemNoticeRecipient.createMany({
                data: users.map((user) => ({
                  noticeId,
                  userId: user.id,
                  emailSnapshot: user.email
                })),
                skipDuplicates: true
              })
            ).count
          : 0;
        const complete = users.length < take;
        await tx.systemNotice.update({
          where: { id: noticeId },
          data: {
            recipientCursor: users.at(-1)?.id ?? notice.recipientCursor,
            recipientsMaterializedAt: complete ? now : null
          }
        });
        return { created, complete };
      });
    },

    async claimRecipients(noticeId, limit, now, leaseExpiresAt) {
      const leaseToken = randomUUID();
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          noticeId: string;
          userId: string;
          emailSnapshot: string;
          attempts: number;
          previousStatus: SystemNoticeRecipientStatus;
          previousAttempts: number;
        }>
      >(Prisma.sql`
        WITH candidates AS (
          SELECT
            recipient."id",
            recipient."status" AS "previousStatus",
            recipient."attempts" AS "previousAttempts"
          FROM "SystemNoticeRecipient" recipient
          INNER JOIN "SystemNotice" notice ON notice."id" = recipient."noticeId"
          WHERE recipient."noticeId" = ${noticeId}
            AND notice."status" = 'SENDING'::"SystemNoticeStatus"
            AND recipient."attempts" < ${MAX_RECIPIENT_ATTEMPTS}
            AND (
              recipient."status" = 'PENDING'::"SystemNoticeRecipientStatus"
              OR (
                recipient."status" = 'RETRY'::"SystemNoticeRecipientStatus"
                AND (recipient."nextAttemptAt" IS NULL OR recipient."nextAttemptAt" <= ${now})
              )
              OR (
                recipient."status" = 'SENDING'::"SystemNoticeRecipientStatus"
                AND recipient."leaseExpiresAt" <= ${now}
              )
            )
          ORDER BY recipient."createdAt" ASC, recipient."id" ASC
          FOR UPDATE OF recipient SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "SystemNoticeRecipient" recipient
        SET
          "status" = 'SENDING'::"SystemNoticeRecipientStatus",
          "attempts" = recipient."attempts" + 1,
          "lastAttemptAt" = ${now},
          "nextAttemptAt" = NULL,
          "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "updatedAt" = ${now}
        FROM candidates
        WHERE recipient."id" = candidates."id"
        RETURNING
          recipient."id",
          recipient."noticeId",
          recipient."userId",
          recipient."emailSnapshot",
          recipient."attempts",
          candidates."previousStatus",
          candidates."previousAttempts"
      `);
      return rows.map((row) => ({ ...row, leaseToken }));
    },

    async releaseUnattemptedClaims(recipients, now) {
      if (!recipients.length) return;
      await client.$transaction(
        recipients.map((recipient) =>
          client.systemNoticeRecipient.updateMany({
            where: {
              id: recipient.id,
              status: SystemNoticeRecipientStatus.SENDING,
              leaseToken: recipient.leaseToken
            },
            data: {
              status:
                recipient.previousStatus === SystemNoticeRecipientStatus.SENDING
                  ? SystemNoticeRecipientStatus.RETRY
                  : recipient.previousStatus,
              attempts: recipient.previousAttempts,
              nextAttemptAt:
                recipient.previousStatus === SystemNoticeRecipientStatus.SENDING ? now : null,
              leaseToken: null,
              leaseExpiresAt: null
            }
          })
        )
      );
    },

    async markRecipientSent(recipient, providerMessageId, now) {
      const updated = await client.systemNoticeRecipient.updateMany({
        where: {
          id: recipient.id,
          status: SystemNoticeRecipientStatus.SENDING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: SystemNoticeRecipientStatus.SENT,
          providerMessageId,
          sentAt: now,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null
        }
      });
      return updated.count === 1;
    },

    async markRecipientFailed(recipient, failure, now) {
      const permanent = failure.permanent || recipient.attempts >= MAX_RECIPIENT_ATTEMPTS;
      const retryDelay = RETRY_DELAYS_MS[
        Math.min(Math.max(recipient.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)
      ];
      await client.systemNoticeRecipient.updateMany({
        where: {
          id: recipient.id,
          status: SystemNoticeRecipientStatus.SENDING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: permanent
            ? SystemNoticeRecipientStatus.PERMANENT_FAILURE
            : SystemNoticeRecipientStatus.RETRY,
          nextAttemptAt: permanent ? null : new Date(now.getTime() + retryDelay),
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: failure.errorCode
        }
      });
    },

    async markExhaustedRetriesPermanent(noticeId) {
      const updated = await client.systemNoticeRecipient.updateMany({
        where: {
          noticeId,
          status: SystemNoticeRecipientStatus.RETRY,
          attempts: { gte: MAX_RECIPIENT_ATTEMPTS }
        },
        data: {
          status: SystemNoticeRecipientStatus.PERMANENT_FAILURE,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: "MAX_ATTEMPTS_EXCEEDED"
        }
      });
      return updated.count;
    },

    async getProgress(noticeId) {
      const notice = await client.systemNotice.findUnique({
        where: { id: noticeId },
        select: { recipientCursor: true, recipientsMaterializedAt: true }
      });
      const [materializedRemaining, permanentFailures, unmaterializedUsers] = await Promise.all([
        client.systemNoticeRecipient.count({
          where: {
            noticeId,
            status: {
              in: [
                SystemNoticeRecipientStatus.PENDING,
                SystemNoticeRecipientStatus.SENDING,
                SystemNoticeRecipientStatus.RETRY
              ]
            }
          }
        }),
        client.systemNoticeRecipient.count({
          where: { noticeId, status: SystemNoticeRecipientStatus.PERMANENT_FAILURE }
        }),
        notice && !notice.recipientsMaterializedAt
          ? client.user.count({ where: notice.recipientCursor ? { id: { gt: notice.recipientCursor } } : undefined })
          : Promise.resolve(0)
      ]);
      return {
        materialized: Boolean(notice?.recipientsMaterializedAt),
        remaining: materializedRemaining + unmaterializedUsers,
        permanentFailures
      };
    },

    async markCompleted(noticeId, now) {
      const updated = await client.systemNotice.updateMany({
        where: { id: noticeId, status: SystemNoticeStatus.SENDING },
        data: { status: SystemNoticeStatus.COMPLETED, completedAt: now, lastErrorCode: null }
      });
      return updated.count === 1;
    }
  };
}

const defaultAudit: ProcessorAudit = async ({ action, notice, metadata }) => {
  await recordAuditEvent({
    actor: { email: "system@sendloom.net", name: "Sendloom system" },
    action,
    category: "SYSTEM",
    severity: action === "system_notice.delivery_completed" ? "SUCCESS" : "INFO",
    target: { type: "SystemNotice", id: notice.id, name: notice.title },
    metadata: { noticeId: notice.id, status: notice.status, ...metadata }
  });
};

export async function processSystemNotices(options: {
  store?: SystemNoticeStore;
  mailer?: SystemNoticeMailer;
  audit?: ProcessorAudit;
  now?: () => Date;
  runtime?: { nodeEnv: string | undefined; vercelEnv: string | undefined; processingEnabled: boolean };
  batchSize?: number;
  maxPerRun?: number;
} = {}): Promise<SystemNoticeProcessorResult> {
  const store = options.store ?? createPrismaSystemNoticeStore(prisma);
  const mailer = options.mailer ?? resendSystemNoticeMailer;
  const audit = options.audit ?? defaultAudit;
  const now = options.now ?? (() => new Date());
  const batchSize = Math.min(Math.max(options.batchSize ?? env.SYSTEM_NOTICE_BATCH_SIZE, 1), 50);
  const maxPerRun = Math.max(options.maxPerRun ?? env.SYSTEM_NOTICE_MAX_PER_RUN, 1);
  const runtime =
    options.runtime ??
    ({
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      processingEnabled: env.SYSTEM_NOTICE_PROCESSING_ENABLED
    } as const);
  const deliveryEnabled = canDeliverSystemNotices(runtime);
  const result: SystemNoticeProcessorResult = {
    noticesDue: 0,
    noticesStarted: 0,
    noticesCompleted: 0,
    recipientsMaterialized: 0,
    recipientsSent: 0,
    recipientsRemaining: 0,
    failures: 0,
    deliveryEnabled
  };

  // Preview, Development, local, test, and CI must not even materialize the
  // account audience. The admin UI may still create drafts in an isolated DB.
  if (!deliveryEnabled) {
    console.info("[system-notice] Delivery disabled by production safety gate.");
    return result;
  }

  const notices = await store.listProcessable(now());
  result.noticesDue = notices.length;
  if (notices.length > 0 && !mailer.isConfigured()) {
    result.failures = 1;
    console.error("[system-notice] Delivery configuration is missing.", {
      errorCode: "RESEND_NOT_CONFIGURED"
    });
    return result;
  }

  let stopRun = false;
  let remainingRunCapacity = maxPerRun;

  for (const notice of notices) {
    if (stopRun || remainingRunCapacity <= 0) break;
    if (await store.markSending(notice.id, now())) {
      notice.status = SystemNoticeStatus.SENDING;
      notice.startedAt = now();
      result.noticesStarted += 1;
      await audit({ action: "system_notice.delivery_started", notice });
    }

    while (!stopRun && remainingRunCapacity > 0) {
      const claimed = await store.claimRecipients(
        notice.id,
        Math.min(batchSize, remainingRunCapacity),
        now(),
        new Date(now().getTime() + RECIPIENT_LEASE_MS)
      );

      if (!claimed.length) {
        const materialized = await store.materializeRecipientPage(notice.id, batchSize, now());
        result.recipientsMaterialized += materialized.created;
        if (materialized.created > 0 || !materialized.complete) continue;
        break;
      }

      for (let index = 0; index < claimed.length; index += 1) {
        const recipient = claimed[index];
        const delivery = await mailer.send({
          to: recipient.emailSnapshot,
          notice,
          idempotencyKey: `system-notice-${notice.id}-${recipient.id}`
        });
        remainingRunCapacity -= 1;

        if (delivery.status === "accepted") {
          if (await store.markRecipientSent(recipient, delivery.providerMessageId, now())) {
            result.recipientsSent += 1;
          }
          continue;
        }

        result.failures += 1;
        await store.markRecipientFailed(
          recipient,
          { permanent: delivery.status === "permanent", errorCode: delivery.errorCode },
          now()
        );
        if (delivery.status === "retryable" && delivery.stopRun) {
          await store.releaseUnattemptedClaims(claimed.slice(index + 1), now());
          stopRun = true;
          console.warn("[system-notice] Pausing after a provider-wide or transient failure.", {
            noticeId: notice.id,
            errorCode: delivery.errorCode
          });
          break;
        }
      }
    }

    result.failures += await store.markExhaustedRetriesPermanent(notice.id);
    const progress = await store.getProgress(notice.id);
    if (progress.materialized && progress.remaining === 0) {
      if (await store.markCompleted(notice.id, now())) {
        notice.status = SystemNoticeStatus.COMPLETED;
        result.noticesCompleted += 1;
        await audit({
          action: "system_notice.delivery_completed",
          notice,
          metadata: { permanentFailureCount: progress.permanentFailures }
        });
      }
    }
  }

  const active = await store.listProcessable(now());
  for (const notice of active) {
    result.recipientsRemaining += (await store.getProgress(notice.id)).remaining;
  }
  return result;
}
