import { randomUUID } from "node:crypto";

import {
  LegalPolicyNoticeRecipientStatus,
  LegalPolicyNoticeStatus,
  Prisma,
  type PrismaClient
} from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  resendLegalNoticeMailer,
  type LegalNoticeEmailPolicy,
  type LegalNoticeMailer
} from "@/lib/legal-notice-email";
import { computeLegalPolicyContentHash } from "@/lib/legal-policy-fingerprint";
import {
  LEGAL_POLICY_LIST,
  validateLegalPolicyRegistry,
  type LegalPolicy,
  type LegalPolicyId,
  type LegalPolicyPath
} from "@/lib/legal-policies";

const RECIPIENT_LEASE_MS = 10 * 60 * 1000;
const MAX_RECIPIENT_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000, 12 * 60 * 60 * 1000];

type StoredPolicyVersion = {
  id: string;
  version: string;
  contentHash: string;
  status: LegalPolicyNoticeStatus;
  createdAt: Date;
};

export type PolicyReleaseDecision =
  | { action: "baseline" }
  | { action: "notice" }
  | { action: "noop"; noticeId: string }
  | { action: "error"; code: "CONTENT_CHANGED_WITHOUT_VERSION_BUMP" | "CHANGE_SUMMARY_REQUIRED" | "VERSION_NOT_NEWER" };

export type LegalNoticeRecord = {
  id: string;
  policy: LegalPolicyId;
  version: string;
  policyTitle: string;
  policyPath: LegalPolicyPath;
  contentHash: string;
  lastUpdated: string;
  changeSummary: string[];
  status: LegalPolicyNoticeStatus;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
};

export type ClaimedLegalNoticeRecipient = {
  id: string;
  noticeId: string;
  emailSnapshot: string;
  attempts: number;
  leaseToken: string;
  previousStatus: LegalPolicyNoticeRecipientStatus;
  previousAttempts: number;
};

export type LegalNoticeStore = {
  listPolicyHistory(policy: LegalPolicyId): Promise<StoredPolicyVersion[]>;
  createBaseline(policy: LegalPolicy, contentHash: string): Promise<boolean>;
  createNotice(policy: LegalPolicy, contentHash: string): Promise<boolean>;
  listActiveNotices(): Promise<LegalNoticeRecord[]>;
  markNoticeProcessing(noticeId: string, now: Date): Promise<boolean>;
  materializeRecipientPage(noticeId: string, take: number, now: Date): Promise<{ created: number; complete: boolean }>;
  claimRecipients(
    noticeId: string,
    limit: number,
    now: Date,
    leaseExpiresAt: Date
  ): Promise<ClaimedLegalNoticeRecipient[]>;
  releaseUnattemptedClaims(recipients: ClaimedLegalNoticeRecipient[], now: Date): Promise<void>;
  markRecipientSent(recipient: ClaimedLegalNoticeRecipient, providerMessageId: string, now: Date): Promise<boolean>;
  markRecipientFailed(
    recipient: ClaimedLegalNoticeRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ): Promise<void>;
  markExhaustedRetriesPermanent(noticeId: string): Promise<number>;
  getNoticeProgress(noticeId: string): Promise<{ materialized: boolean; remaining: number; permanentFailures: number }>;
  markNoticeCompleted(noticeId: string, now: Date): Promise<boolean>;
};

type AuditEvent = (input: {
  action: "legal.notice_started" | "legal.notice_completed" | "legal.notice_failed";
  notice: LegalNoticeRecord;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type LegalNoticeProcessorResult = {
  detectedPolicies: number;
  baselinesCreated: number;
  noticesCreated: number;
  noticesStarted: number;
  noticesCompleted: number;
  recipientsMaterialized: number;
  recipientsSent: number;
  recipientsRemaining: number;
  failures: number;
  deliveryEnabled: boolean;
};

function parsePolicyVersion(version: string) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:-v([2-9]|[1-9]\d+))?$/.exec(version);
  if (!match) return null;
  return { date: match[1], revision: match[2] ? Number(match[2]) : 1 };
}

export function comparePolicyVersions(left: string, right: string) {
  const parsedLeft = parsePolicyVersion(left);
  const parsedRight = parsePolicyVersion(right);
  if (!parsedLeft || !parsedRight) return left.localeCompare(right);
  const dateComparison = parsedLeft.date.localeCompare(parsedRight.date);
  return dateComparison || parsedLeft.revision - parsedRight.revision;
}

export function evaluatePolicyRelease(
  policy: LegalPolicy,
  contentHash: string,
  history: readonly StoredPolicyVersion[]
): PolicyReleaseDecision {
  if (history.length === 0) return { action: "baseline" };

  const sameVersion = history.find((release) => release.version === policy.version);
  if (sameVersion) {
    if (sameVersion.contentHash !== contentHash) {
      return { action: "error", code: "CONTENT_CHANGED_WITHOUT_VERSION_BUMP" };
    }
    return { action: "noop", noticeId: sameVersion.id };
  }

  const latest = history[0];
  if (comparePolicyVersions(policy.version, latest.version) <= 0) {
    return { action: "error", code: "VERSION_NOT_NEWER" };
  }

  if (policy.changeSummary.length === 0 || policy.changeSummary.some((item) => !item.trim())) {
    return { action: "error", code: "CHANGE_SUMMARY_REQUIRED" };
  }

  return { action: "notice" };
}

export function canDeliverLegalPolicyNotices(input: {
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
  processingEnabled: boolean;
}) {
  return isLegalPolicyProductionRuntime(input) && input.processingEnabled;
}

export function isLegalPolicyProductionRuntime(input: {
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
}) {
  return input.nodeEnv === "production" && input.vercelEnv === "production";
}

export type AccountRecipientQuery = Prisma.UserFindManyArgs;

/** Account email only; deliberately has no passwordHash/googleSub/sender filter. */
export function getAccountRecipientPage(
  findMany: (args: AccountRecipientQuery) => Promise<Array<{ id: string; email: string }>>,
  input: { cursor: string | null; take: number }
) {
  return findMany({
    select: { id: true, email: true },
    orderBy: { id: "asc" },
    take: input.take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {})
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid legal notice changeSummary in the database.");
  }
  return value as string[];
}

function mapNotice(record: {
  id: string;
  policy: string;
  version: string;
  policyTitle: string;
  policyPath: string;
  contentHash: string;
  lastUpdated: string;
  changeSummary: Prisma.JsonValue;
  status: LegalPolicyNoticeStatus;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
}): LegalNoticeRecord {
  return {
    ...record,
    policy: record.policy as LegalPolicyId,
    policyPath: record.policyPath as LegalPolicyPath,
    changeSummary: jsonStringArray(record.changeSummary)
  };
}

export function createPrismaLegalNoticeStore(client: PrismaClient): LegalNoticeStore {
  return {
    listPolicyHistory(policy) {
      return client.legalPolicyNotice.findMany({
        where: { policy },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, version: true, contentHash: true, status: true, createdAt: true }
      });
    },

    async createBaseline(policy, contentHash) {
      try {
        await client.legalPolicyNotice.create({
          data: {
            policy: policy.id,
            version: policy.version,
            policyTitle: policy.title,
            policyPath: policy.path,
            contentHash,
            lastUpdated: policy.lastUpdated,
            changeSummary: [...policy.changeSummary],
            status: LegalPolicyNoticeStatus.BASELINE,
            recipientsMaterializedAt: new Date(),
            completedAt: new Date()
          }
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintError(error)) return false;
        throw error;
      }
    },

    async createNotice(policy, contentHash) {
      try {
        await client.legalPolicyNotice.create({
          data: {
            policy: policy.id,
            version: policy.version,
            policyTitle: policy.title,
            policyPath: policy.path,
            contentHash,
            lastUpdated: policy.lastUpdated,
            changeSummary: [...policy.changeSummary],
            status: LegalPolicyNoticeStatus.PENDING
          }
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintError(error)) return false;
        throw error;
      }
    },

    async listActiveNotices() {
      const records = await client.legalPolicyNotice.findMany({
        where: { status: { in: [LegalPolicyNoticeStatus.PENDING, LegalPolicyNoticeStatus.PROCESSING] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
      return records.map(mapNotice);
    },

    async markNoticeProcessing(noticeId, now) {
      const result = await client.legalPolicyNotice.updateMany({
        where: { id: noticeId, status: LegalPolicyNoticeStatus.PENDING },
        data: { status: LegalPolicyNoticeStatus.PROCESSING, startedAt: now, lastErrorCode: null }
      });
      return result.count === 1;
    },

    async materializeRecipientPage(noticeId, take, now) {
      const notice = await client.legalPolicyNotice.findUnique({
        where: { id: noticeId },
        select: { recipientCursor: true, recipientsMaterializedAt: true }
      });
      if (!notice || notice.recipientsMaterializedAt) return { created: 0, complete: true };

      const users = await getAccountRecipientPage(
        (args) => client.user.findMany(args) as Promise<Array<{ id: string; email: string }>>,
        { cursor: notice.recipientCursor, take }
      );
      const created = users.length
        ? (
            await client.legalPolicyNoticeRecipient.createMany({
              data: users.map((user) => ({
                noticeId,
                userId: user.id,
                emailSnapshot: user.email,
                status: LegalPolicyNoticeRecipientStatus.PENDING
              })),
              skipDuplicates: true
            })
          ).count
        : 0;
      const complete = users.length < take;
      const nextCursor = users.at(-1)?.id ?? notice.recipientCursor;

      await client.legalPolicyNotice.updateMany({
        where: { id: noticeId, recipientCursor: notice.recipientCursor },
        data: {
          recipientCursor: nextCursor,
          recipientsMaterializedAt: complete ? now : null
        }
      });

      return { created, complete };
    },

    async claimRecipients(noticeId, limit, now, leaseExpiresAt) {
      const leaseToken = randomUUID();
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          noticeId: string;
          emailSnapshot: string;
          attempts: number;
          previousStatus: LegalPolicyNoticeRecipientStatus;
          previousAttempts: number;
        }>
      >(Prisma.sql`
        WITH candidates AS (
          SELECT
            recipient."id",
            recipient."status" AS "previousStatus",
            recipient."attempts" AS "previousAttempts"
          FROM "LegalPolicyNoticeRecipient" recipient
          WHERE recipient."noticeId" = ${noticeId}
            AND recipient."attempts" < ${MAX_RECIPIENT_ATTEMPTS}
            AND (
              recipient."status" = 'PENDING'::"LegalPolicyNoticeRecipientStatus"
              OR (
                recipient."status" = 'FAILED_RETRYABLE'::"LegalPolicyNoticeRecipientStatus"
                AND (recipient."nextAttemptAt" IS NULL OR recipient."nextAttemptAt" <= ${now})
              )
              OR (
                recipient."status" = 'PROCESSING'::"LegalPolicyNoticeRecipientStatus"
                AND recipient."leaseExpiresAt" <= ${now}
              )
            )
          ORDER BY recipient."createdAt" ASC, recipient."id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "LegalPolicyNoticeRecipient" recipient
        SET
          "status" = 'PROCESSING'::"LegalPolicyNoticeRecipientStatus",
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
          recipient."emailSnapshot",
          recipient."attempts",
          candidates."previousStatus",
          candidates."previousAttempts"
      `);

      return rows.map((row) => ({ ...row, leaseToken }));
    },

    async releaseUnattemptedClaims(recipients, now) {
      if (recipients.length === 0) return;
      await client.$transaction(
        recipients.map((recipient) =>
          client.legalPolicyNoticeRecipient.updateMany({
            where: {
              id: recipient.id,
              status: LegalPolicyNoticeRecipientStatus.PROCESSING,
              leaseToken: recipient.leaseToken
            },
            data: {
              status:
                recipient.previousStatus === LegalPolicyNoticeRecipientStatus.PROCESSING
                  ? LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
                  : recipient.previousStatus,
              attempts: recipient.previousAttempts,
              nextAttemptAt:
                recipient.previousStatus === LegalPolicyNoticeRecipientStatus.PROCESSING ? now : null,
              leaseToken: null,
              leaseExpiresAt: null
            }
          })
        )
      );
    },

    async markRecipientSent(recipient, providerMessageId, now) {
      const result = await client.legalPolicyNoticeRecipient.updateMany({
        where: {
          id: recipient.id,
          status: LegalPolicyNoticeRecipientStatus.PROCESSING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: LegalPolicyNoticeRecipientStatus.SENT,
          providerMessageId,
          sentAt: now,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null
        }
      });
      return result.count === 1;
    },

    async markRecipientFailed(recipient, failure, now) {
      const permanent = failure.permanent || recipient.attempts >= MAX_RECIPIENT_ATTEMPTS;
      const retryDelay = RETRY_DELAYS_MS[Math.min(Math.max(recipient.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
      await client.legalPolicyNoticeRecipient.updateMany({
        where: {
          id: recipient.id,
          status: LegalPolicyNoticeRecipientStatus.PROCESSING,
          leaseToken: recipient.leaseToken
        },
        data: {
          status: permanent
            ? LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT
            : LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE,
          nextAttemptAt: permanent ? null : new Date(now.getTime() + retryDelay),
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: failure.errorCode
        }
      });
    },

    async markExhaustedRetriesPermanent(noticeId) {
      const result = await client.legalPolicyNoticeRecipient.updateMany({
        where: {
          noticeId,
          status: LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE,
          attempts: { gte: MAX_RECIPIENT_ATTEMPTS }
        },
        data: {
          status: LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: "MAX_ATTEMPTS_EXCEEDED"
        }
      });
      return result.count;
    },

    async getNoticeProgress(noticeId) {
      const notice = await client.legalPolicyNotice.findUnique({
        where: { id: noticeId },
        select: { recipientCursor: true, recipientsMaterializedAt: true }
      });
      const [materializedRemaining, permanentFailures, unmaterializedUsers] = await Promise.all([
        client.legalPolicyNoticeRecipient.count({
          where: {
            noticeId,
            status: {
              in: [
                LegalPolicyNoticeRecipientStatus.PENDING,
                LegalPolicyNoticeRecipientStatus.PROCESSING,
                LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
              ]
            }
          }
        }),
        client.legalPolicyNoticeRecipient.count({
          where: { noticeId, status: LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT }
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

    async markNoticeCompleted(noticeId, now) {
      const result = await client.legalPolicyNotice.updateMany({
        where: { id: noticeId, status: LegalPolicyNoticeStatus.PROCESSING },
        data: { status: LegalPolicyNoticeStatus.COMPLETED, completedAt: now, lastErrorCode: null }
      });
      return result.count === 1;
    }
  };
}

const defaultAuditEvent: AuditEvent = async ({ action, notice, metadata }) => {
  await recordAuditEvent({
    actor: { email: "system@sendloom.net", name: "Sendloom system" },
    action,
    category: "SYSTEM",
    severity: action === "legal.notice_failed" ? "ERROR" : action === "legal.notice_completed" ? "SUCCESS" : "INFO",
    target: { type: "LegalPolicyNotice", id: notice.id, name: `${notice.policy}:${notice.version}` },
    metadata: { policy: notice.policy, version: notice.version, ...metadata }
  });
};

function noticeEmailPolicy(notice: LegalNoticeRecord): LegalNoticeEmailPolicy {
  return {
    id: notice.policy,
    title: notice.policyTitle,
    path: notice.policyPath,
    version: notice.version,
    lastUpdated: notice.lastUpdated,
    changeSummary: notice.changeSummary
  };
}

export async function processLegalPolicyNotices(options: {
  store?: LegalNoticeStore;
  mailer?: LegalNoticeMailer;
  policies?: readonly LegalPolicy[];
  auditEvent?: AuditEvent;
  now?: () => Date;
  runtime?: { nodeEnv: string | undefined; vercelEnv: string | undefined; processingEnabled: boolean };
  batchSize?: number;
  maxPerRun?: number;
} = {}): Promise<LegalNoticeProcessorResult> {
  const store = options.store ?? createPrismaLegalNoticeStore(prisma);
  const mailer = options.mailer ?? resendLegalNoticeMailer;
  const policies = options.policies ?? LEGAL_POLICY_LIST;
  const auditEvent = options.auditEvent ?? defaultAuditEvent;
  const now = options.now ?? (() => new Date());
  const batchSize = Math.min(Math.max(options.batchSize ?? env.LEGAL_NOTICE_BATCH_SIZE, 1), 50);
  const maxPerRun = Math.max(options.maxPerRun ?? env.LEGAL_NOTICE_MAX_PER_RUN, 1);
  const runtime =
    options.runtime ??
    ({
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      processingEnabled: env.LEGAL_NOTICE_PROCESSING_ENABLED
    } as const);
  const deliveryEnabled = canDeliverLegalPolicyNotices(runtime);
  const result: LegalNoticeProcessorResult = {
    detectedPolicies: policies.length,
    baselinesCreated: 0,
    noticesCreated: 0,
    noticesStarted: 0,
    noticesCompleted: 0,
    recipientsMaterialized: 0,
    recipientsSent: 0,
    recipientsRemaining: 0,
    failures: 0,
    deliveryEnabled
  };

  const registryErrors = validateLegalPolicyRegistry(policies);
  if (registryErrors.length > 0) {
    console.error("[legal-notice] Invalid legal policy registry.", { errorCount: registryErrors.length });
    result.failures += registryErrors.length;
    return result;
  }

  // Do not let a Preview deployment that happens to share a database create a
  // durable release before that policy is actually live in Production.
  if (!isLegalPolicyProductionRuntime(runtime)) {
    console.info("[legal-notice] Skipping durable detection outside Vercel Production.", {
      detectedPolicyCount: policies.length
    });
    return result;
  }

  for (const policy of policies) {
    const contentHash = computeLegalPolicyContentHash(policy);
    const history = await store.listPolicyHistory(policy.id);
    const decision = evaluatePolicyRelease(policy, contentHash, history);

    if (decision.action === "baseline") {
      if (await store.createBaseline(policy, contentHash)) {
        result.baselinesCreated += 1;
        console.info("[legal-notice] Established policy baseline.", {
          policy: policy.id,
          version: policy.version
        });
      }
      continue;
    }

    if (decision.action === "notice") {
      if (await store.createNotice(policy, contentHash)) {
        result.noticesCreated += 1;
        console.info("[legal-notice] Created policy notice.", {
          policy: policy.id,
          version: policy.version
        });
      }
      continue;
    }

    if (decision.action === "error") {
      result.failures += 1;
      console.error("[legal-notice] Policy release rejected.", {
        policy: policy.id,
        version: policy.version,
        errorCode: decision.code
      });
    }
  }

  let activeNotices = await store.listActiveNotices();
  if (!deliveryEnabled) {
    for (const notice of activeNotices) {
      result.recipientsRemaining += (await store.getNoticeProgress(notice.id)).remaining;
    }
    console.info("[legal-notice] Delivery disabled by production safety gate.", {
      activeNoticeCount: activeNotices.length
    });
    return result;
  }

  if (activeNotices.length > 0 && !mailer.isConfigured()) {
    result.failures += 1;
    console.error("[legal-notice] Delivery configuration is missing.", {
      activeNoticeCount: activeNotices.length,
      errorCode: "RESEND_NOT_CONFIGURED"
    });
    return result;
  }

  let stopRun = false;
  let remainingRunCapacity = maxPerRun;

  for (const notice of activeNotices) {
    if (stopRun || remainingRunCapacity <= 0) break;

    if (await store.markNoticeProcessing(notice.id, now())) {
      result.noticesStarted += 1;
      notice.status = LegalPolicyNoticeStatus.PROCESSING;
      await auditEvent({ action: "legal.notice_started", notice });
    }

    while (!stopRun && remainingRunCapacity > 0) {
      const claimed = await store.claimRecipients(
        notice.id,
        Math.min(batchSize, remainingRunCapacity),
        now(),
        new Date(now().getTime() + RECIPIENT_LEASE_MS)
      );

      if (claimed.length === 0) {
        const progress = await store.getNoticeProgress(notice.id);
        if (!progress.materialized) {
          const materialized = await store.materializeRecipientPage(notice.id, batchSize, now());
          result.recipientsMaterialized += materialized.created;
          if (materialized.created > 0) continue;
        }
        break;
      }

      for (let index = 0; index < claimed.length; index += 1) {
        const recipient = claimed[index];
        const delivery = await mailer.send({
          to: recipient.emailSnapshot,
          policy: noticeEmailPolicy(notice),
          idempotencyKey: `legal-notice-${notice.id}-${recipient.id}`
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
          console.warn("[legal-notice] Pausing delivery after a transient provider failure.", {
            policy: notice.policy,
            version: notice.version,
            noticeId: notice.id,
            errorCode: delivery.errorCode
          });
          break;
        }
      }
    }

    result.failures += await store.markExhaustedRetriesPermanent(notice.id);
    const progress = await store.getNoticeProgress(notice.id);
    if (progress.materialized && progress.remaining === 0) {
      if (await store.markNoticeCompleted(notice.id, now())) {
        result.noticesCompleted += 1;
        await auditEvent({
          action: "legal.notice_completed",
          notice,
          metadata: { permanentFailureCount: progress.permanentFailures }
        });
        console.info("[legal-notice] Completed policy notice.", {
          policy: notice.policy,
          version: notice.version,
          noticeId: notice.id,
          permanentFailureCount: progress.permanentFailures
        });
      }
    }
  }

  activeNotices = await store.listActiveNotices();
  for (const notice of activeNotices) {
    result.recipientsRemaining += (await store.getNoticeProgress(notice.id)).remaining;
  }

  return result;
}
