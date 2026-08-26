import {
  SystemNoticeRecipientStatus,
  SystemNoticeStatus,
  type Prisma
} from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  SystemNoticeActionError,
  SystemNoticeValidationError,
  ensureFutureScheduledInstant,
  type SystemNoticeInput
} from "@/lib/system-notices";

type AdminActor = { id: string; email: string };
type RecipientCounts = Record<SystemNoticeRecipientStatus, number>;

const EMPTY_RECIPIENT_COUNTS: RecipientCounts = {
  PENDING: 0,
  SENDING: 0,
  SENT: 0,
  RETRY: 0,
  PERMANENT_FAILURE: 0
};

const noticeInclude = {
  createdBy: { select: { id: true, email: true } }
} satisfies Prisma.SystemNoticeInclude;

type NoticeWithCreator = Prisma.SystemNoticeGetPayload<{ include: typeof noticeInclude }>;

function contentData(input: SystemNoticeInput) {
  return {
    type: input.type,
    subject: input.subject,
    title: input.title,
    message: input.message,
    affectedArea: input.affectedArea,
    scheduledSendAt: input.scheduledSendAt,
    impactStartsAt: input.impactStartsAt,
    impactEndsAt: input.impactEndsAt,
    timeZone: input.timeZone
  };
}

function mapNotice(notice: NoticeWithCreator, counts: RecipientCounts) {
  const recipientTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const remaining = counts.PENDING + counts.SENDING + counts.RETRY;
  return {
    id: notice.id,
    type: notice.type,
    status: notice.status,
    subject: notice.subject,
    title: notice.title,
    message: notice.message,
    affectedArea: notice.affectedArea,
    scheduledSendAt: notice.scheduledSendAt?.toISOString() ?? null,
    impactStartsAt: notice.impactStartsAt?.toISOString() ?? null,
    impactEndsAt: notice.impactEndsAt?.toISOString() ?? null,
    timeZone: notice.timeZone,
    recipientsMaterializedAt: notice.recipientsMaterializedAt?.toISOString() ?? null,
    startedAt: notice.startedAt?.toISOString() ?? null,
    completedAt: notice.completedAt?.toISOString() ?? null,
    cancelledAt: notice.cancelledAt?.toISOString() ?? null,
    createdAt: notice.createdAt.toISOString(),
    updatedAt: notice.updatedAt.toISOString(),
    createdBy: notice.createdBy,
    delivery: {
      recipientTotal,
      sent: counts.SENT,
      permanentFailures: counts.PERMANENT_FAILURE,
      retryable: counts.RETRY,
      remaining
    }
  };
}

async function recipientCountsByNotice(noticeIds: string[]) {
  const grouped = noticeIds.length
    ? await prisma.systemNoticeRecipient.groupBy({
        by: ["noticeId", "status"],
        where: { noticeId: { in: noticeIds } },
        _count: { _all: true }
      })
    : [];
  const counts = new Map<string, RecipientCounts>();
  for (const row of grouped) {
    const current = counts.get(row.noticeId) ?? { ...EMPTY_RECIPIENT_COUNTS };
    current[row.status] = row._count._all;
    counts.set(row.noticeId, current);
  }
  return counts;
}

export async function listSystemNotices() {
  const [notices, accountRecipientCount] = await Promise.all([
    prisma.systemNotice.findMany({
      include: noticeInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200
    }),
    prisma.user.count()
  ]);
  const counts = await recipientCountsByNotice(notices.map((notice) => notice.id));
  const items = notices.map((notice) => mapNotice(notice, counts.get(notice.id) ?? { ...EMPTY_RECIPIENT_COUNTS }));
  return {
    notices: items,
    accountRecipientCount,
    summary: {
      scheduled: items.filter((notice) => notice.status === SystemNoticeStatus.SCHEDULED).length,
      sending: items.filter((notice) => notice.status === SystemNoticeStatus.SENDING).length,
      completed: items.filter((notice) => notice.status === SystemNoticeStatus.COMPLETED).length,
      attention: items.filter(
        (notice) =>
          notice.status === SystemNoticeStatus.FAILED ||
          notice.delivery.permanentFailures > 0 ||
          notice.delivery.retryable > 0
      ).length
    }
  };
}

export async function getSystemNotice(id: string) {
  const notice = await prisma.systemNotice.findUnique({ where: { id }, include: noticeInclude });
  if (!notice) return null;
  const counts = await recipientCountsByNotice([id]);
  return mapNotice(notice, counts.get(id) ?? { ...EMPTY_RECIPIENT_COUNTS });
}

async function auditNoticeAction(input: {
  action:
    | "system_notice.created"
    | "system_notice.updated"
    | "system_notice.scheduled"
    | "system_notice.send_now_requested"
    | "system_notice.cancelled";
  notice: { id: string; title: string; status: SystemNoticeStatus };
  actor: AdminActor;
  request?: Request;
}) {
  await recordAuditEvent({
    actor: input.actor,
    action: input.action,
    category: "ADMIN",
    severity: input.action === "system_notice.cancelled" ? "WARNING" : "INFO",
    target: { type: "SystemNotice", id: input.notice.id, name: input.notice.title },
    metadata: { noticeId: input.notice.id, status: input.notice.status },
    request: input.request
  });
}

export async function createSystemNotice(input: SystemNoticeInput, actor: AdminActor, request?: Request) {
  if (input.scheduledSendAt) ensureFutureScheduledInstant(input.scheduledSendAt);
  const notice = await prisma.systemNotice.create({
    data: { ...contentData(input), createdByUserId: actor.id },
    include: noticeInclude
  });
  await auditNoticeAction({ action: "system_notice.created", notice, actor, request });
  return mapNotice(notice, { ...EMPTY_RECIPIENT_COUNTS });
}

export async function updateSystemNotice(id: string, input: SystemNoticeInput, actor: AdminActor, request?: Request) {
  if (input.scheduledSendAt) ensureFutureScheduledInstant(input.scheduledSendAt);
  const current = await prisma.systemNotice.findUnique({
    where: { id },
    select: { status: true, scheduledSendAt: true }
  });
  if (!current) throw new SystemNoticeActionError("System notice not found.", 404);
  if (current.status !== SystemNoticeStatus.DRAFT && current.status !== SystemNoticeStatus.SCHEDULED) {
    throw new SystemNoticeActionError("This notice is immutable because delivery has started.", 409);
  }
  const data = contentData(input);
  // Switching an already-scheduled notice to "send now" is a two-step admin
  // flow: save the immutable content first, then atomically move scheduledAt to
  // the server clock in the action route. Preserve the old instant in between
  // so a dropped browser request can never leave SCHEDULED with a null due time.
  if (current.status === SystemNoticeStatus.SCHEDULED && !data.scheduledSendAt) {
    data.scheduledSendAt = current.scheduledSendAt;
  }

  const updated = await prisma.systemNotice.updateMany({
    where: {
      id,
      status: { in: [SystemNoticeStatus.DRAFT, SystemNoticeStatus.SCHEDULED] },
      startedAt: null
    },
    data
  });
  if (updated.count !== 1) {
    throw new SystemNoticeActionError("This notice changed state and can no longer be edited.", 409);
  }
  const notice = await prisma.systemNotice.findUniqueOrThrow({ where: { id }, include: noticeInclude });
  await auditNoticeAction({ action: "system_notice.updated", notice, actor, request });
  return getSystemNotice(id);
}

export async function scheduleSystemNotice(
  id: string,
  scheduledSendAt: Date,
  timeZone: string,
  actor: AdminActor,
  request?: Request
) {
  ensureFutureScheduledInstant(scheduledSendAt);
  const updated = await prisma.systemNotice.updateMany({
    where: {
      id,
      status: { in: [SystemNoticeStatus.DRAFT, SystemNoticeStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: SystemNoticeStatus.SCHEDULED, scheduledSendAt, timeZone, cancelledAt: null }
  });
  if (updated.count !== 1) {
    const exists = await prisma.systemNotice.findUnique({ where: { id }, select: { id: true } });
    throw new SystemNoticeActionError(
      exists ? "Only a draft or not-yet-started scheduled notice can be scheduled." : "System notice not found.",
      exists ? 409 : 404
    );
  }
  const notice = await prisma.systemNotice.findUniqueOrThrow({ where: { id }, include: noticeInclude });
  await auditNoticeAction({ action: "system_notice.scheduled", notice, actor, request });
  return getSystemNotice(id);
}

export async function requestSystemNoticeSendNow(id: string, actor: AdminActor, request?: Request) {
  const now = new Date();
  const updated = await prisma.systemNotice.updateMany({
    where: {
      id,
      status: { in: [SystemNoticeStatus.DRAFT, SystemNoticeStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: SystemNoticeStatus.SCHEDULED, scheduledSendAt: now, cancelledAt: null }
  });
  if (updated.count !== 1) {
    const exists = await prisma.systemNotice.findUnique({ where: { id }, select: { id: true } });
    throw new SystemNoticeActionError(
      exists ? "Only a draft or not-yet-started scheduled notice can be sent." : "System notice not found.",
      exists ? 409 : 404
    );
  }
  const notice = await prisma.systemNotice.findUniqueOrThrow({ where: { id }, include: noticeInclude });
  await auditNoticeAction({ action: "system_notice.send_now_requested", notice, actor, request });
  return getSystemNotice(id);
}

export async function cancelSystemNotice(id: string, actor: AdminActor, request?: Request) {
  const now = new Date();
  const updated = await prisma.systemNotice.updateMany({
    where: {
      id,
      status: { in: [SystemNoticeStatus.DRAFT, SystemNoticeStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: SystemNoticeStatus.CANCELLED, cancelledAt: now }
  });
  if (updated.count !== 1) {
    const exists = await prisma.systemNotice.findUnique({ where: { id }, select: { id: true } });
    throw new SystemNoticeActionError(
      exists ? "Delivery has started, so this notice can no longer be cancelled." : "System notice not found.",
      exists ? 409 : 404
    );
  }
  const notice = await prisma.systemNotice.findUniqueOrThrow({ where: { id }, include: noticeInclude });
  await auditNoticeAction({ action: "system_notice.cancelled", notice, actor, request });
  return getSystemNotice(id);
}
