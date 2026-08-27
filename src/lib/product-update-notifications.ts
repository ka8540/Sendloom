import { randomUUID } from "node:crypto";

import {
  Prisma,
  ProductUpdateBroadcastRecipientStatus,
  ProductUpdateBroadcastStatus,
  type PrismaClient
} from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  resendProductUpdateMailer,
  type ProductUpdateEmailInput,
  type ProductUpdateMailer
} from "@/lib/product-update-email";
import { parseStoredProductUpdateFeatures } from "@/lib/product-update-broadcasts";

const RECIPIENT_LEASE_MS = 10 * 60 * 1000;
const MAX_RECIPIENT_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000, 12 * 60 * 60 * 1000];

export type ProductUpdateBroadcastRecord = ProductUpdateEmailInput & {
  id: string;
  status: ProductUpdateBroadcastStatus;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
  startedAt: Date | null;
};

export type ClaimedProductUpdateRecipient = {
  id: string;
  broadcastId: string;
  userId: string;
  emailSnapshot: string;
  attempts: number;
  leaseToken: string;
  previousStatus: ProductUpdateBroadcastRecipientStatus;
  previousAttempts: number;
};

export type ProductUpdateStore = {
  listProcessable(now: Date): Promise<ProductUpdateBroadcastRecord[]>;
  markSending(broadcastId: string, now: Date): Promise<boolean>;
  materializeRecipientPage(broadcastId: string, take: number, now: Date): Promise<{ created: number; complete: boolean }>;
  claimRecipients(
    broadcastId: string,
    limit: number,
    now: Date,
    leaseExpiresAt: Date
  ): Promise<ClaimedProductUpdateRecipient[]>;
  releaseUnattemptedClaims(recipients: ClaimedProductUpdateRecipient[], now: Date): Promise<void>;
  markRecipientSent(recipient: ClaimedProductUpdateRecipient, providerMessageId: string, now: Date): Promise<boolean>;
  markRecipientFailed(
    recipient: ClaimedProductUpdateRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ): Promise<void>;
  markExhaustedRetriesPermanent(broadcastId: string): Promise<number>;
  getProgress(broadcastId: string): Promise<{ materialized: boolean; remaining: number; permanentFailures: number }>;
  markCompleted(broadcastId: string, now: Date): Promise<boolean>;
};

type ProcessorAudit = (input: {
  action: "product_update.delivery_started" | "product_update.delivery_completed";
  broadcast: ProductUpdateBroadcastRecord;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type ProductUpdateProcessorResult = {
  broadcastsDue: number;
  broadcastsStarted: number;
  broadcastsCompleted: number;
  recipientsMaterialized: number;
  recipientsSent: number;
  recipientsRemaining: number;
  failures: number;
  deliveryEnabled: boolean;
};

export function canDeliverProductUpdates(input: {
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
  processingEnabled: boolean;
}) {
  return input.nodeEnv === "production" && input.vercelEnv === "production" && input.processingEnabled;
}

export type ProductUpdateAccountRecipientQuery = Prisma.UserFindManyArgs;

/** Product updates are delivered only to persisted Sendloom account users. */
export function getProductUpdateAccountRecipientPage(
  findMany: (args: ProductUpdateAccountRecipientQuery) => Promise<Array<{ id: string; email: string }>>,
  input: { cursor: string | null; take: number }
) {
  return findMany({
    select: { id: true, email: true },
    orderBy: { id: "asc" },
    take: input.take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {})
  });
}

function mapBroadcast(record: {
  id: string;
  status: ProductUpdateBroadcastStatus;
  subject: string;
  headline: string;
  intro: string;
  features: Prisma.JsonValue;
  scheduledSendAt: Date | null;
  timeZone: string;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
  startedAt: Date | null;
}): ProductUpdateBroadcastRecord {
  return { ...record, features: parseStoredProductUpdateFeatures(record.features) };
}

export function createPrismaProductUpdateStore(client: PrismaClient): ProductUpdateStore {
  return {
    async listProcessable(now) {
      const broadcasts = await client.productUpdateBroadcast.findMany({
        where: {
          OR: [
            { status: ProductUpdateBroadcastStatus.SCHEDULED, scheduledSendAt: { lte: now } },
            { status: ProductUpdateBroadcastStatus.SENDING }
          ]
        },
        orderBy: [{ scheduledSendAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 20,
        select: {
          id: true,
          status: true,
          subject: true,
          headline: true,
          intro: true,
          features: true,
          scheduledSendAt: true,
          timeZone: true,
          recipientCursor: true,
          recipientsMaterializedAt: true,
          startedAt: true
        }
      });
      return broadcasts.map(mapBroadcast);
    },

    async markSending(broadcastId, now) {
      const updated = await client.productUpdateBroadcast.updateMany({
        where: {
          id: broadcastId,
          status: ProductUpdateBroadcastStatus.SCHEDULED,
          scheduledSendAt: { lte: now },
          cancelledAt: null,
          startedAt: null
        },
        data: { status: ProductUpdateBroadcastStatus.SENDING, startedAt: now, lastErrorCode: null }
      });
      return updated.count === 1;
    },

    async materializeRecipientPage(broadcastId, take, now) {
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            status: ProductUpdateBroadcastStatus;
            recipientCursor: string | null;
            recipientsMaterializedAt: Date | null;
          }>
        >(Prisma.sql`
          SELECT "status", "recipientCursor", "recipientsMaterializedAt"
          FROM "ProductUpdateBroadcast"
          WHERE "id" = ${broadcastId}
          FOR UPDATE
        `);
        const broadcast = rows[0];
        if (
          !broadcast ||
          broadcast.status !== ProductUpdateBroadcastStatus.SENDING ||
          broadcast.recipientsMaterializedAt
        ) {
          return { created: 0, complete: true };
        }

        const users = await getProductUpdateAccountRecipientPage(
          (args) => tx.user.findMany(args) as Promise<Array<{ id: string; email: string }>>,
          { cursor: broadcast.recipientCursor, take }
        );
        const created = users.length
          ? (
              await tx.productUpdateBroadcastRecipient.createMany({
                data: users.map((user) => ({
                  broadcastId,
                  userId: user.id,
                  emailSnapshot: user.email
                })),
                skipDuplicates: true
              })
            ).count
          : 0;
        const complete = users.length < take;
        await tx.productUpdateBroadcast.update({
          where: { id: broadcastId },
          data: {
            recipientCursor: users.at(-1)?.id ?? broadcast.recipientCursor,
            recipientsMaterializedAt: complete ? now : null
          }
        });
        return { created, complete };
      });
    },

    async claimRecipients(broadcastId, limit, now, leaseExpiresAt) {
      const leaseToken = randomUUID();
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          broadcastId: string;
          userId: string;
          emailSnapshot: string;
          attempts: number;
          previousStatus: ProductUpdateBroadcastRecipientStatus;
          previousAttempts: number;
        }>
      >(Prisma.sql`
        WITH candidates AS (
          SELECT
            recipient."id",
            recipient."status" AS "previousStatus",
            recipient."attempts" AS "previousAttempts"
          FROM "ProductUpdateBroadcastRecipient" recipient
          INNER JOIN "ProductUpdateBroadcast" broadcast ON broadcast."id" = recipient."broadcastId"
          WHERE recipient."broadcastId" = ${broadcastId}
            AND broadcast."status" = 'SENDING'::"ProductUpdateBroadcastStatus"
            AND recipient."attempts" < ${MAX_RECIPIENT_ATTEMPTS}
            AND (
              recipient."status" = 'PENDING'::"ProductUpdateBroadcastRecipientStatus"
              OR (
                recipient."status" = 'RETRY'::"ProductUpdateBroadcastRecipientStatus"
                AND (recipient."nextAttemptAt" IS NULL OR recipient."nextAttemptAt" <= ${now})
              )
              OR (
                recipient."status" = 'SENDING'::"ProductUpdateBroadcastRecipientStatus"
                AND recipient."leaseExpiresAt" <= ${now}
              )
            )
          ORDER BY recipient."createdAt" ASC, recipient."id" ASC
          FOR UPDATE OF recipient SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "ProductUpdateBroadcastRecipient" recipient
        SET
          "status" = 'SENDING'::"ProductUpdateBroadcastRecipientStatus",
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
          recipient."broadcastId",
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
          client.productUpdateBroadcastRecipient.updateMany({
            where: {
              id: recipient.id,
              status: ProductUpdateBroadcastRecipientStatus.SENDING,
              leaseToken: recipient.leaseToken
            },
            data: {
              status:
                recipient.previousStatus === ProductUpdateBroadcastRecipientStatus.SENDING
                  ? ProductUpdateBroadcastRecipientStatus.RETRY
                  : recipient.previousStatus,
              attempts: recipient.previousAttempts,
              nextAttemptAt:
                recipient.previousStatus === ProductUpdateBroadcastRecipientStatus.SENDING ? now : null,
              leaseToken: null,
              leaseExpiresAt: null
            }
          })
        )
      );
    },

    async markRecipientSent(recipient, providerMessageId, now) {
      const updated = await client.productUpdateBroadcastRecipient.updateMany({
        where: {
          id: recipient.id,
          status: ProductUpdateBroadcastRecipientStatus.SENDING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: ProductUpdateBroadcastRecipientStatus.SENT,
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
      await client.productUpdateBroadcastRecipient.updateMany({
        where: {
          id: recipient.id,
          status: ProductUpdateBroadcastRecipientStatus.SENDING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: permanent
            ? ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE
            : ProductUpdateBroadcastRecipientStatus.RETRY,
          nextAttemptAt: permanent ? null : new Date(now.getTime() + retryDelay),
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: failure.errorCode
        }
      });
    },

    async markExhaustedRetriesPermanent(broadcastId) {
      const updated = await client.productUpdateBroadcastRecipient.updateMany({
        where: {
          broadcastId,
          status: ProductUpdateBroadcastRecipientStatus.RETRY,
          attempts: { gte: MAX_RECIPIENT_ATTEMPTS }
        },
        data: {
          status: ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: "MAX_ATTEMPTS_EXCEEDED"
        }
      });
      return updated.count;
    },

    async getProgress(broadcastId) {
      const broadcast = await client.productUpdateBroadcast.findUnique({
        where: { id: broadcastId },
        select: { recipientCursor: true, recipientsMaterializedAt: true }
      });
      const [materializedRemaining, permanentFailures, unmaterializedUsers] = await Promise.all([
        client.productUpdateBroadcastRecipient.count({
          where: {
            broadcastId,
            status: {
              in: [
                ProductUpdateBroadcastRecipientStatus.PENDING,
                ProductUpdateBroadcastRecipientStatus.SENDING,
                ProductUpdateBroadcastRecipientStatus.RETRY
              ]
            }
          }
        }),
        client.productUpdateBroadcastRecipient.count({
          where: { broadcastId, status: ProductUpdateBroadcastRecipientStatus.PERMANENT_FAILURE }
        }),
        broadcast && !broadcast.recipientsMaterializedAt
          ? client.user.count({ where: broadcast.recipientCursor ? { id: { gt: broadcast.recipientCursor } } : undefined })
          : Promise.resolve(0)
      ]);
      return {
        materialized: Boolean(broadcast?.recipientsMaterializedAt),
        remaining: materializedRemaining + unmaterializedUsers,
        permanentFailures
      };
    },

    async markCompleted(broadcastId, now) {
      const updated = await client.productUpdateBroadcast.updateMany({
        where: { id: broadcastId, status: ProductUpdateBroadcastStatus.SENDING },
        data: { status: ProductUpdateBroadcastStatus.COMPLETED, completedAt: now, lastErrorCode: null }
      });
      return updated.count === 1;
    }
  };
}

const defaultAudit: ProcessorAudit = async ({ action, broadcast, metadata }) => {
  await recordAuditEvent({
    actor: { email: "system@sendloom.net", name: "Sendloom system" },
    action,
    category: "SYSTEM",
    severity: action === "product_update.delivery_completed" ? "SUCCESS" : "INFO",
    target: { type: "ProductUpdateBroadcast", id: broadcast.id, name: broadcast.headline },
    metadata: { broadcastId: broadcast.id, status: broadcast.status, ...metadata }
  });
};

export async function processProductUpdateBroadcasts(options: {
  store?: ProductUpdateStore;
  mailer?: ProductUpdateMailer;
  audit?: ProcessorAudit;
  now?: () => Date;
  runtime?: { nodeEnv: string | undefined; vercelEnv: string | undefined; processingEnabled: boolean };
  batchSize?: number;
  maxPerRun?: number;
} = {}): Promise<ProductUpdateProcessorResult> {
  const store = options.store ?? createPrismaProductUpdateStore(prisma);
  const mailer = options.mailer ?? resendProductUpdateMailer;
  const audit = options.audit ?? defaultAudit;
  const now = options.now ?? (() => new Date());
  const batchSize = Math.min(Math.max(options.batchSize ?? env.PRODUCT_UPDATE_BATCH_SIZE, 1), 50);
  const maxPerRun = Math.min(Math.max(options.maxPerRun ?? env.PRODUCT_UPDATE_MAX_PER_RUN, 1), 500);
  const runtime =
    options.runtime ??
    ({
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      processingEnabled: env.PRODUCT_UPDATE_PROCESSING_ENABLED
    } as const);
  const deliveryEnabled = canDeliverProductUpdates(runtime);
  const result: ProductUpdateProcessorResult = {
    broadcastsDue: 0,
    broadcastsStarted: 0,
    broadcastsCompleted: 0,
    recipientsMaterialized: 0,
    recipientsSent: 0,
    recipientsRemaining: 0,
    failures: 0,
    deliveryEnabled
  };

  // Development, Preview, test, and disabled production runs cannot even
  // snapshot the account audience, much less call Resend.
  if (!deliveryEnabled) {
    console.info("[product-update] Delivery disabled by production safety gate.");
    return result;
  }

  const broadcasts = await store.listProcessable(now());
  result.broadcastsDue = broadcasts.length;
  if (broadcasts.length > 0 && !mailer.isConfigured()) {
    result.failures = 1;
    console.error("[product-update] Delivery configuration is missing.", {
      errorCode: "RESEND_NOT_CONFIGURED"
    });
    return result;
  }

  let stopRun = false;
  let remainingRunCapacity = maxPerRun;

  for (const broadcast of broadcasts) {
    if (stopRun || remainingRunCapacity <= 0) break;
    if (await store.markSending(broadcast.id, now())) {
      broadcast.status = ProductUpdateBroadcastStatus.SENDING;
      broadcast.startedAt = now();
      result.broadcastsStarted += 1;
      await audit({ action: "product_update.delivery_started", broadcast });
    }

    while (!stopRun && remainingRunCapacity > 0) {
      const claimed = await store.claimRecipients(
        broadcast.id,
        Math.min(batchSize, remainingRunCapacity),
        now(),
        new Date(now().getTime() + RECIPIENT_LEASE_MS)
      );

      if (!claimed.length) {
        const materialized = await store.materializeRecipientPage(broadcast.id, batchSize, now());
        result.recipientsMaterialized += materialized.created;
        if (materialized.created > 0 || !materialized.complete) continue;
        break;
      }

      for (let index = 0; index < claimed.length; index += 1) {
        const recipient = claimed[index];
        const delivery = await mailer.send({
          to: recipient.emailSnapshot,
          broadcast,
          idempotencyKey: `product-update-${broadcast.id}-${recipient.id}`
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
          console.warn("[product-update] Pausing after a provider-wide or transient failure.", {
            broadcastId: broadcast.id,
            errorCode: delivery.errorCode
          });
          break;
        }
      }
    }

    result.failures += await store.markExhaustedRetriesPermanent(broadcast.id);
    const progress = await store.getProgress(broadcast.id);
    if (progress.materialized && progress.remaining === 0) {
      if (await store.markCompleted(broadcast.id, now())) {
        broadcast.status = ProductUpdateBroadcastStatus.COMPLETED;
        result.broadcastsCompleted += 1;
        await audit({
          action: "product_update.delivery_completed",
          broadcast,
          metadata: { permanentFailureCount: progress.permanentFailures }
        });
      }
    }
  }

  const active = await store.listProcessable(now());
  for (const broadcast of active) {
    result.recipientsRemaining += (await store.getProgress(broadcast.id)).remaining;
  }
  return result;
}
