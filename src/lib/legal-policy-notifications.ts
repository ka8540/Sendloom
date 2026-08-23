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
  | { action: "noop"; noticeId: string; status: LegalPolicyNoticeStatus }
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
  releaseId: string | null;
};

export type LegalPolicyReleaseRecord = {
  id: string;
  releaseGroup: string;
  status: LegalPolicyNoticeStatus;
  recipientCursor: string | null;
  recipientsMaterializedAt: Date | null;
  notices: LegalNoticeRecord[];
};

export type ClaimedLegalReleaseRecipient = {
  id: string;
  releaseId: string;
  userId: string;
  emailSnapshot: string;
  attempts: number;
  leaseToken: string;
  previousStatus: LegalPolicyNoticeRecipientStatus;
  previousAttempts: number;
};

export type LegalNoticeStore = {
  listPolicyHistory(policy: LegalPolicyId): Promise<StoredPolicyVersion[]>;
  createBaseline(policy: LegalPolicy, contentHash: string): Promise<boolean>;
  createNotice(policy: LegalPolicy, contentHash: string): Promise<{ noticeCreated: boolean; releaseCreated: boolean }>;
  ensureNoticeRelease(
    policy: LegalPolicy,
    noticeId: string
  ): Promise<{ releaseCreated: boolean; conflict: boolean }>;
  listActiveReleases(): Promise<LegalPolicyReleaseRecord[]>;
  markReleaseProcessing(
    releaseId: string,
    now: Date
  ): Promise<{ releaseStarted: boolean; noticesStarted: number }>;
  materializeRecipientPage(releaseId: string, take: number, now: Date): Promise<{ created: number; complete: boolean }>;
  claimRecipients(
    releaseId: string,
    limit: number,
    now: Date,
    leaseExpiresAt: Date
  ): Promise<ClaimedLegalReleaseRecipient[]>;
  releaseUnattemptedClaims(recipients: ClaimedLegalReleaseRecipient[], now: Date): Promise<void>;
  markRecipientSent(
    recipient: ClaimedLegalReleaseRecipient,
    providerMessageId: string,
    now: Date
  ): Promise<boolean>;
  markRecipientFailed(
    recipient: ClaimedLegalReleaseRecipient,
    failure: { permanent: boolean; errorCode: string },
    now: Date
  ): Promise<void>;
  markExhaustedRetriesPermanent(releaseId: string): Promise<number>;
  getReleaseProgress(releaseId: string): Promise<{ materialized: boolean; remaining: number; permanentFailures: number }>;
  markReleaseCompleted(
    releaseId: string,
    now: Date
  ): Promise<{ releaseCompleted: boolean; noticesCompleted: number }>;
};

type AuditEvent = (input: {
  action: "legal.notice_started" | "legal.notice_completed" | "legal.notice_failed";
  release: LegalPolicyReleaseRecord;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type LegalNoticeProcessorResult = {
  detectedPolicies: number;
  baselinesCreated: number;
  noticesCreated: number;
  releasesCreated: number;
  releasesStarted: number;
  releasesCompleted: number;
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
    return { action: "noop", noticeId: sameVersion.id, status: sameVersion.status };
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
  releaseId: string | null;
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
        const releaseCreated = await client.$transaction(async (tx) => {
          const existingRelease = await tx.legalPolicyRelease.findUnique({
            where: { releaseGroup: policy.releaseGroup },
            select: { id: true, status: true }
          });
          if (existingRelease && existingRelease.status !== LegalPolicyNoticeStatus.PENDING) {
            throw new Error(`Legal releaseGroup is already active or completed: ${policy.releaseGroup}`);
          }
          const release = await tx.legalPolicyRelease.upsert({
            where: { releaseGroup: policy.releaseGroup },
            create: { releaseGroup: policy.releaseGroup },
            update: {},
            select: { id: true }
          });
          await tx.legalPolicyNotice.create({
            data: {
              policy: policy.id,
              version: policy.version,
              policyTitle: policy.title,
              policyPath: policy.path,
              contentHash,
              lastUpdated: policy.lastUpdated,
              changeSummary: [...policy.changeSummary],
              status: LegalPolicyNoticeStatus.PENDING,
              releaseId: release.id
            }
          });
          return !existingRelease;
        });
        return { noticeCreated: true, releaseCreated };
      } catch (error) {
        if (isUniqueConstraintError(error)) return { noticeCreated: false, releaseCreated: false };
        throw error;
      }
    },

    async ensureNoticeRelease(policy, noticeId) {
      return client.$transaction(async (tx) => {
        const notice = await tx.legalPolicyNotice.findUnique({
          where: { id: noticeId },
          select: { releaseId: true, release: { select: { releaseGroup: true } } }
        });
        if (!notice) return { releaseCreated: false, conflict: true };
        if (notice.releaseId) {
          return {
            releaseCreated: false,
            conflict: notice.release?.releaseGroup !== policy.releaseGroup
          };
        }
        const existingRelease = await tx.legalPolicyRelease.findUnique({
          where: { releaseGroup: policy.releaseGroup },
          select: { id: true }
        });
        const release = await tx.legalPolicyRelease.upsert({
          where: { releaseGroup: policy.releaseGroup },
          create: { releaseGroup: policy.releaseGroup },
          update: {},
          select: { id: true }
        });
        await tx.legalPolicyNotice.update({ where: { id: noticeId }, data: { releaseId: release.id } });
        return { releaseCreated: !existingRelease, conflict: false };
      });
    },

    async listActiveReleases() {
      const releases = await client.legalPolicyRelease.findMany({
        where: {
          status: { in: [LegalPolicyNoticeStatus.PENDING, LegalPolicyNoticeStatus.PROCESSING] },
          notices: { some: {} }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          notices: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          }
        }
      });
      return releases.map((release) => ({
        id: release.id,
        releaseGroup: release.releaseGroup,
        status: release.status,
        recipientCursor: release.recipientCursor,
        recipientsMaterializedAt: release.recipientsMaterializedAt,
        notices: release.notices.map(mapNotice)
      }));
    },

    async markReleaseProcessing(releaseId, now) {
      return client.$transaction(async (tx) => {
        const release = await tx.legalPolicyRelease.updateMany({
          where: { id: releaseId, status: LegalPolicyNoticeStatus.PENDING },
          data: { status: LegalPolicyNoticeStatus.PROCESSING, startedAt: now, lastErrorCode: null }
        });
        const notices = await tx.legalPolicyNotice.updateMany({
          where: { releaseId, status: LegalPolicyNoticeStatus.PENDING },
          data: { status: LegalPolicyNoticeStatus.PROCESSING, startedAt: now, lastErrorCode: null }
        });
        return { releaseStarted: release.count === 1, noticesStarted: notices.count };
      });
    },

    async materializeRecipientPage(releaseId, take, now) {
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ recipientCursor: string | null; recipientsMaterializedAt: Date | null }>
        >(Prisma.sql`
          SELECT "recipientCursor", "recipientsMaterializedAt"
          FROM "LegalPolicyRelease"
          WHERE "id" = ${releaseId}
          FOR UPDATE
        `);
        const release = rows[0];
        if (!release || release.recipientsMaterializedAt) return { created: 0, complete: true };

        const users = await getAccountRecipientPage(
          (args) => tx.user.findMany(args) as Promise<Array<{ id: string; email: string }>>,
          { cursor: release.recipientCursor, take }
        );
        const noticeIds = (
          await tx.legalPolicyNotice.findMany({ where: { releaseId }, select: { id: true } })
        ).map((notice) => notice.id);
        const legacyDeliveries =
          users.length > 0 && noticeIds.length > 0
            ? await tx.legalPolicyNoticeRecipient.findMany({
                where: {
                  noticeId: { in: noticeIds },
                  userId: { in: users.map((user) => user.id) },
                  status: LegalPolicyNoticeRecipientStatus.SENT
                },
                orderBy: [{ sentAt: "asc" }, { id: "asc" }],
                select: { userId: true, providerMessageId: true, sentAt: true }
              })
            : [];
        const legacyByUser = new Map<
          string,
          { providerMessageId: string | null; sentAt: Date | null }
        >();
        for (const delivery of legacyDeliveries) {
          if (!legacyByUser.has(delivery.userId)) legacyByUser.set(delivery.userId, delivery);
        }

        const created = users.length
          ? (
              await tx.legalPolicyReleaseRecipient.createMany({
                data: users.map((user) => {
                  const legacy = legacyByUser.get(user.id);
                  return {
                    releaseId,
                    userId: user.id,
                    emailSnapshot: user.email,
                    status: legacy
                      ? LegalPolicyNoticeRecipientStatus.SENT
                      : LegalPolicyNoticeRecipientStatus.PENDING,
                    providerMessageId: legacy?.providerMessageId ?? null,
                    sentAt: legacy?.sentAt ?? null
                  };
                }),
                skipDuplicates: true
              })
            ).count
          : 0;
        const complete = users.length < take;
        await tx.legalPolicyRelease.update({
          where: { id: releaseId },
          data: {
            recipientCursor: users.at(-1)?.id ?? release.recipientCursor,
            recipientsMaterializedAt: complete ? now : null
          }
        });
        return { created, complete };
      });
    },

    async claimRecipients(releaseId, limit, now, leaseExpiresAt) {
      const leaseToken = randomUUID();
      const rows = await client.$queryRaw<
        Array<{
          id: string;
          releaseId: string;
          userId: string;
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
          FROM "LegalPolicyReleaseRecipient" recipient
          WHERE recipient."releaseId" = ${releaseId}
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
        UPDATE "LegalPolicyReleaseRecipient" recipient
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
          recipient."releaseId",
          recipient."userId",
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
          client.legalPolicyReleaseRecipient.updateMany({
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
      const result = await client.legalPolicyReleaseRecipient.updateMany({
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
      await client.legalPolicyReleaseRecipient.updateMany({
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

    async markExhaustedRetriesPermanent(releaseId) {
      const result = await client.legalPolicyReleaseRecipient.updateMany({
        where: {
          releaseId,
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

    async getReleaseProgress(releaseId) {
      const release = await client.legalPolicyRelease.findUnique({
        where: { id: releaseId },
        select: { recipientCursor: true, recipientsMaterializedAt: true }
      });
      const [materializedRemaining, permanentFailures, unmaterializedUsers] = await Promise.all([
        client.legalPolicyReleaseRecipient.count({
          where: {
            releaseId,
            status: {
              in: [
                LegalPolicyNoticeRecipientStatus.PENDING,
                LegalPolicyNoticeRecipientStatus.PROCESSING,
                LegalPolicyNoticeRecipientStatus.FAILED_RETRYABLE
              ]
            }
          }
        }),
        client.legalPolicyReleaseRecipient.count({
          where: { releaseId, status: LegalPolicyNoticeRecipientStatus.FAILED_PERMANENT }
        }),
        release && !release.recipientsMaterializedAt
          ? client.user.count({ where: release.recipientCursor ? { id: { gt: release.recipientCursor } } : undefined })
          : Promise.resolve(0)
      ]);
      return {
        materialized: Boolean(release?.recipientsMaterializedAt),
        remaining: materializedRemaining + unmaterializedUsers,
        permanentFailures
      };
    },

    async markReleaseCompleted(releaseId, now) {
      return client.$transaction(async (tx) => {
        const release = await tx.legalPolicyRelease.updateMany({
          where: { id: releaseId, status: LegalPolicyNoticeStatus.PROCESSING },
          data: { status: LegalPolicyNoticeStatus.COMPLETED, completedAt: now, lastErrorCode: null }
        });
        if (release.count !== 1) return { releaseCompleted: false, noticesCompleted: 0 };
        const notices = await tx.legalPolicyNotice.updateMany({
          where: {
            releaseId,
            status: {
              in: [
                LegalPolicyNoticeStatus.PENDING,
                LegalPolicyNoticeStatus.PROCESSING,
                LegalPolicyNoticeStatus.FAILED
              ]
            }
          },
          data: { status: LegalPolicyNoticeStatus.COMPLETED, completedAt: now, lastErrorCode: null }
        });
        return { releaseCompleted: true, noticesCompleted: notices.count };
      });
    }
  };
}

const defaultAuditEvent: AuditEvent = async ({ action, release, metadata }) => {
  await recordAuditEvent({
    actor: { email: "system@sendloom.net", name: "Sendloom system" },
    action,
    category: "SYSTEM",
    severity: action === "legal.notice_failed" ? "ERROR" : action === "legal.notice_completed" ? "SUCCESS" : "INFO",
    target: { type: "LegalPolicyRelease", id: release.id, name: release.releaseGroup },
    metadata: {
      releaseGroup: release.releaseGroup,
      policies: release.notices.map((notice) => notice.policy),
      ...metadata
    }
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
    releasesCreated: 0,
    releasesStarted: 0,
    releasesCompleted: 0,
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
        console.info("[legal-notice] Established policy baseline.", { policy: policy.id, version: policy.version });
      }
      continue;
    }

    if (decision.action === "notice") {
      const created = await store.createNotice(policy, contentHash);
      if (created.noticeCreated) {
        result.noticesCreated += 1;
        if (created.releaseCreated) result.releasesCreated += 1;
        console.info("[legal-notice] Created policy notice in legal release.", {
          policy: policy.id,
          version: policy.version,
          releaseGroup: policy.releaseGroup
        });
      }
      continue;
    }

    if (decision.action === "noop" && decision.status !== LegalPolicyNoticeStatus.BASELINE) {
      const linked = await store.ensureNoticeRelease(policy, decision.noticeId);
      if (linked.conflict) {
        result.failures += 1;
        console.error("[legal-notice] Policy notice releaseGroup conflicts with its durable release.", {
          policy: policy.id,
          version: policy.version,
          releaseGroup: policy.releaseGroup
        });
      } else if (linked.releaseCreated) {
        result.releasesCreated += 1;
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

  let activeReleases = await store.listActiveReleases();
  if (!deliveryEnabled) {
    for (const release of activeReleases) {
      result.recipientsRemaining += (await store.getReleaseProgress(release.id)).remaining;
    }
    console.info("[legal-notice] Delivery disabled by production safety gate.", {
      activeReleaseCount: activeReleases.length
    });
    return result;
  }

  if (activeReleases.length > 0 && !mailer.isConfigured()) {
    result.failures += 1;
    console.error("[legal-notice] Delivery configuration is missing.", {
      activeReleaseCount: activeReleases.length,
      errorCode: "RESEND_NOT_CONFIGURED"
    });
    return result;
  }

  let stopRun = false;
  let remainingRunCapacity = maxPerRun;

  for (const release of activeReleases) {
    if (stopRun || remainingRunCapacity <= 0) break;

    const started = await store.markReleaseProcessing(release.id, now());
    if (started.releaseStarted) {
      result.releasesStarted += 1;
      release.status = LegalPolicyNoticeStatus.PROCESSING;
      await auditEvent({ action: "legal.notice_started", release });
    }
    result.noticesStarted += started.noticesStarted;

    while (!stopRun && remainingRunCapacity > 0) {
      const claimed = await store.claimRecipients(
        release.id,
        Math.min(batchSize, remainingRunCapacity),
        now(),
        new Date(now().getTime() + RECIPIENT_LEASE_MS)
      );

      if (claimed.length === 0) {
        const progress = await store.getReleaseProgress(release.id);
        if (!progress.materialized) {
          const materialized = await store.materializeRecipientPage(release.id, batchSize, now());
          result.recipientsMaterialized += materialized.created;
          if (!materialized.complete || materialized.created > 0) continue;
        }
        break;
      }

      for (let index = 0; index < claimed.length; index += 1) {
        const recipient = claimed[index];
        const delivery = await mailer.send({
          to: recipient.emailSnapshot,
          policies: release.notices.map(noticeEmailPolicy),
          releaseGroup: release.releaseGroup,
          idempotencyKey: `legal-release-${release.id}-${recipient.userId}`
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
          console.warn("[legal-notice] Pausing release delivery after a transient provider failure.", {
            releaseGroup: release.releaseGroup,
            releaseId: release.id,
            errorCode: delivery.errorCode
          });
          break;
        }
      }
    }

    result.failures += await store.markExhaustedRetriesPermanent(release.id);
    const progress = await store.getReleaseProgress(release.id);
    if (progress.materialized && progress.remaining === 0) {
      const completed = await store.markReleaseCompleted(release.id, now());
      if (completed.releaseCompleted) {
        result.releasesCompleted += 1;
        result.noticesCompleted += completed.noticesCompleted;
        await auditEvent({
          action: "legal.notice_completed",
          release,
          metadata: { permanentFailureCount: progress.permanentFailures }
        });
        console.info("[legal-notice] Completed legal release notice.", {
          releaseGroup: release.releaseGroup,
          releaseId: release.id,
          policyCount: release.notices.length,
          permanentFailureCount: progress.permanentFailures
        });
      }
    }
  }

  activeReleases = await store.listActiveReleases();
  for (const release of activeReleases) {
    result.recipientsRemaining += (await store.getReleaseProgress(release.id)).remaining;
  }

  return result;
}
