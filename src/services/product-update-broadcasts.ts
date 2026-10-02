import {
  ProductUpdateBroadcastRecipientStatus,
  ProductUpdateBroadcastStatus,
  type Prisma
} from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { normalizeAdminPage } from "@/services/admin-v2/pagination";
import {
  ProductUpdateActionError,
  ensureFutureProductUpdateInstant,
  parseStoredProductUpdateFeatures,
  type ProductUpdateBroadcastInput
} from "@/lib/product-update-broadcasts";

type AdminActor = { id: string; email: string };
type RecipientCounts = Record<ProductUpdateBroadcastRecipientStatus, number>;

const EMPTY_RECIPIENT_COUNTS: RecipientCounts = {
  PENDING: 0,
  SENDING: 0,
  SENT: 0,
  RETRY: 0,
  PERMANENT_FAILURE: 0
};

const broadcastInclude = {
  createdBy: { select: { id: true, email: true } }
} satisfies Prisma.ProductUpdateBroadcastInclude;

type BroadcastWithCreator = Prisma.ProductUpdateBroadcastGetPayload<{ include: typeof broadcastInclude }>;

function contentData(input: ProductUpdateBroadcastInput) {
  return {
    subject: input.subject,
    headline: input.headline,
    intro: input.intro,
    features: input.features as Prisma.InputJsonValue,
    scheduledSendAt: input.scheduledSendAt,
    timeZone: input.timeZone
  };
}

function mapBroadcast(broadcast: BroadcastWithCreator, counts: RecipientCounts) {
  const recipientTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const remaining = counts.PENDING + counts.SENDING + counts.RETRY;
  return {
    id: broadcast.id,
    status: broadcast.status,
    subject: broadcast.subject,
    headline: broadcast.headline,
    intro: broadcast.intro,
    features: parseStoredProductUpdateFeatures(broadcast.features),
    scheduledSendAt: broadcast.scheduledSendAt?.toISOString() ?? null,
    timeZone: broadcast.timeZone,
    recipientsMaterializedAt: broadcast.recipientsMaterializedAt?.toISOString() ?? null,
    startedAt: broadcast.startedAt?.toISOString() ?? null,
    completedAt: broadcast.completedAt?.toISOString() ?? null,
    cancelledAt: broadcast.cancelledAt?.toISOString() ?? null,
    createdAt: broadcast.createdAt.toISOString(),
    updatedAt: broadcast.updatedAt.toISOString(),
    createdBy: broadcast.createdBy,
    delivery: {
      recipientTotal,
      sent: counts.SENT,
      permanentFailures: counts.PERMANENT_FAILURE,
      retryable: counts.RETRY,
      remaining
    }
  };
}

async function recipientCountsByBroadcast(broadcastIds: string[]) {
  const grouped = broadcastIds.length
    ? await prisma.productUpdateBroadcastRecipient.groupBy({
        by: ["broadcastId", "status"],
        where: { broadcastId: { in: broadcastIds } },
        _count: { _all: true }
      })
    : [];
  const counts = new Map<string, RecipientCounts>();
  for (const row of grouped) {
    const current = counts.get(row.broadcastId) ?? { ...EMPTY_RECIPIENT_COUNTS };
    current[row.status] = row._count._all;
    counts.set(row.broadcastId, current);
  }
  return counts;
}

export async function listProductUpdateBroadcasts(requestedPage = 1, requestedActivePage = 1) {
  const historyWhere: Prisma.ProductUpdateBroadcastWhereInput = { status: { notIn: ["SCHEDULED", "SENDING"] } };
  const [historyCount, accountRecipientCount, statusCounts, attentionCount] = await Promise.all([
    prisma.productUpdateBroadcast.count({ where: historyWhere }),
    prisma.user.count(),
    prisma.productUpdateBroadcast.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.productUpdateBroadcast.count({ where: { OR: [{ status: "FAILED" }, { recipients: { some: { status: { in: ["PERMANENT_FAILURE", "RETRY"] } } } }] } })
  ]);
  const page = normalizeAdminPage(requestedPage, historyCount, 20);
  const activeCount = statusCounts.filter((row) => row.status === "SCHEDULED" || row.status === "SENDING").reduce((sum, row) => sum + row._count._all, 0);
  const activePage = normalizeAdminPage(requestedActivePage, activeCount, 20);
  const [active, history] = await Promise.all([
    prisma.productUpdateBroadcast.findMany({
      include: broadcastInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: { status: { in: ["SCHEDULED", "SENDING"] } },
      skip: (activePage - 1) * 20,
      take: 20
    }),
    prisma.productUpdateBroadcast.findMany({ include: broadcastInclude, where: historyWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 })
  ]);
  const broadcasts = [...active, ...history];
  const counts = await recipientCountsByBroadcast(broadcasts.map((broadcast) => broadcast.id));
  const items = broadcasts.map((broadcast) =>
    mapBroadcast(broadcast, counts.get(broadcast.id) ?? { ...EMPTY_RECIPIENT_COUNTS })
  );
  return {
    broadcasts: items,
    accountRecipientCount,
    pagination: { page, pageSize: 20, count: historyCount },
    activePagination: { page: activePage, pageSize: 20, count: activeCount },
    summary: {
      scheduled: statusCounts.find((row) => row.status === ProductUpdateBroadcastStatus.SCHEDULED)?._count._all ?? 0,
      sending: statusCounts.find((row) => row.status === ProductUpdateBroadcastStatus.SENDING)?._count._all ?? 0,
      completed: statusCounts.find((row) => row.status === ProductUpdateBroadcastStatus.COMPLETED)?._count._all ?? 0,
      attention: attentionCount
    }
  };
}

export async function getProductUpdateBroadcast(id: string) {
  const broadcast = await prisma.productUpdateBroadcast.findUnique({ where: { id }, include: broadcastInclude });
  if (!broadcast) return null;
  const counts = await recipientCountsByBroadcast([id]);
  return mapBroadcast(broadcast, counts.get(id) ?? { ...EMPTY_RECIPIENT_COUNTS });
}

async function auditBroadcastAction(input: {
  action:
    | "product_update.created"
    | "product_update.updated"
    | "product_update.scheduled"
    | "product_update.send_now_requested"
    | "product_update.cancelled";
  broadcast: { id: string; headline: string; status: ProductUpdateBroadcastStatus };
  actor: AdminActor;
  request?: Request;
}) {
  await recordAuditEvent({
    actor: input.actor,
    action: input.action,
    category: "ADMIN",
    severity: input.action === "product_update.cancelled" ? "WARNING" : "INFO",
    target: { type: "ProductUpdateBroadcast", id: input.broadcast.id, name: input.broadcast.headline },
    metadata: { broadcastId: input.broadcast.id, status: input.broadcast.status },
    request: input.request
  });
}

export async function createProductUpdateBroadcast(
  input: ProductUpdateBroadcastInput,
  actor: AdminActor,
  request?: Request
) {
  if (input.scheduledSendAt) ensureFutureProductUpdateInstant(input.scheduledSendAt);
  const broadcast = await prisma.productUpdateBroadcast.create({
    data: { ...contentData(input), createdByUserId: actor.id },
    include: broadcastInclude
  });
  await auditBroadcastAction({ action: "product_update.created", broadcast, actor, request });
  return mapBroadcast(broadcast, { ...EMPTY_RECIPIENT_COUNTS });
}

export async function updateProductUpdateBroadcast(
  id: string,
  input: ProductUpdateBroadcastInput,
  actor: AdminActor,
  request?: Request
) {
  if (input.scheduledSendAt) ensureFutureProductUpdateInstant(input.scheduledSendAt);
  const current = await prisma.productUpdateBroadcast.findUnique({
    where: { id },
    select: { status: true, scheduledSendAt: true }
  });
  if (!current) throw new ProductUpdateActionError("Product update not found.", 404);
  if (
    current.status !== ProductUpdateBroadcastStatus.DRAFT &&
    current.status !== ProductUpdateBroadcastStatus.SCHEDULED
  ) {
    throw new ProductUpdateActionError("This product update is immutable because delivery has started.", 409);
  }
  const data = contentData(input);
  if (current.status === ProductUpdateBroadcastStatus.SCHEDULED && !data.scheduledSendAt) {
    data.scheduledSendAt = current.scheduledSendAt;
  }

  const updated = await prisma.productUpdateBroadcast.updateMany({
    where: {
      id,
      status: { in: [ProductUpdateBroadcastStatus.DRAFT, ProductUpdateBroadcastStatus.SCHEDULED] },
      startedAt: null
    },
    data
  });
  if (updated.count !== 1) {
    throw new ProductUpdateActionError("This product update changed state and can no longer be edited.", 409);
  }
  const broadcast = await prisma.productUpdateBroadcast.findUniqueOrThrow({ where: { id }, include: broadcastInclude });
  await auditBroadcastAction({ action: "product_update.updated", broadcast, actor, request });
  return getProductUpdateBroadcast(id);
}

export async function scheduleProductUpdateBroadcast(
  id: string,
  scheduledSendAt: Date,
  timeZone: string,
  actor: AdminActor,
  request?: Request
) {
  ensureFutureProductUpdateInstant(scheduledSendAt);
  const updated = await prisma.productUpdateBroadcast.updateMany({
    where: {
      id,
      status: { in: [ProductUpdateBroadcastStatus.DRAFT, ProductUpdateBroadcastStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: ProductUpdateBroadcastStatus.SCHEDULED, scheduledSendAt, timeZone, cancelledAt: null }
  });
  if (updated.count !== 1) {
    const exists = await prisma.productUpdateBroadcast.findUnique({ where: { id }, select: { id: true } });
    throw new ProductUpdateActionError(
      exists ? "Only a draft or not-yet-started product update can be scheduled." : "Product update not found.",
      exists ? 409 : 404
    );
  }
  const broadcast = await prisma.productUpdateBroadcast.findUniqueOrThrow({ where: { id }, include: broadcastInclude });
  await auditBroadcastAction({ action: "product_update.scheduled", broadcast, actor, request });
  return getProductUpdateBroadcast(id);
}

export async function requestProductUpdateSendNow(id: string, actor: AdminActor, request?: Request) {
  const now = new Date();
  const updated = await prisma.productUpdateBroadcast.updateMany({
    where: {
      id,
      status: { in: [ProductUpdateBroadcastStatus.DRAFT, ProductUpdateBroadcastStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: ProductUpdateBroadcastStatus.SCHEDULED, scheduledSendAt: now, cancelledAt: null }
  });
  if (updated.count !== 1) {
    const exists = await prisma.productUpdateBroadcast.findUnique({ where: { id }, select: { id: true } });
    throw new ProductUpdateActionError(
      exists ? "Only a draft or not-yet-started product update can be sent." : "Product update not found.",
      exists ? 409 : 404
    );
  }
  const broadcast = await prisma.productUpdateBroadcast.findUniqueOrThrow({ where: { id }, include: broadcastInclude });
  await auditBroadcastAction({ action: "product_update.send_now_requested", broadcast, actor, request });
  return getProductUpdateBroadcast(id);
}

export async function cancelProductUpdateBroadcast(id: string, actor: AdminActor, request?: Request) {
  const now = new Date();
  const updated = await prisma.productUpdateBroadcast.updateMany({
    where: {
      id,
      status: { in: [ProductUpdateBroadcastStatus.DRAFT, ProductUpdateBroadcastStatus.SCHEDULED] },
      startedAt: null
    },
    data: { status: ProductUpdateBroadcastStatus.CANCELLED, cancelledAt: now }
  });
  if (updated.count !== 1) {
    const exists = await prisma.productUpdateBroadcast.findUnique({ where: { id }, select: { id: true } });
    throw new ProductUpdateActionError(
      exists ? "Delivery has started, so this product update can no longer be cancelled." : "Product update not found.",
      exists ? 409 : 404
    );
  }
  const broadcast = await prisma.productUpdateBroadcast.findUniqueOrThrow({ where: { id }, include: broadcastInclude });
  await auditBroadcastAction({ action: "product_update.cancelled", broadcast, actor, request });
  return getProductUpdateBroadcast(id);
}
