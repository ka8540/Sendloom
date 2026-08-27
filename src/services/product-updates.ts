import type { ProductUpdate, ProductUpdateIcon, ProductUpdateStatus } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  generateProductUpdateSlug,
  ProductUpdateActionError,
  type ProductUpdateInput
} from "@/lib/product-updates";

export const PRODUCT_UPDATE_USER_PAGE_SIZE = 10;
export const PRODUCT_UPDATE_USER_MAX_PAGE_SIZE = 25;
export const PRODUCT_UPDATE_ADMIN_PAGE_SIZE = 25;
export const PRODUCT_UPDATE_ADMIN_MAX_PAGE_SIZE = 50;

type Actor = { id: string; email: string };

export type PublishedProductUpdateItem = {
  id: string;
  title: string;
  summary: string;
  description: string;
  icon: ProductUpdateIcon;
  ctaLabel: string | null;
  ctaHref: string | null;
  publishedAt: string | null;
  seen: boolean;
};

export type AdminProductUpdateItem = PublishedProductUpdateItem & {
  slug: string;
  status: ProductUpdateStatus;
  createdAt: string;
  updatedAt: string;
  viewsCount: number;
  createdBy: { id: string; email: string };
};

function toPublishedItem(
  update: ProductUpdate & { views: { id: string }[] }
): PublishedProductUpdateItem {
  return {
    id: update.id,
    title: update.title,
    summary: update.summary,
    description: update.description,
    icon: update.icon,
    ctaLabel: update.ctaLabel,
    ctaHref: update.ctaHref,
    publishedAt: update.publishedAt?.toISOString() ?? null,
    seen: update.views.length > 0
  };
}

type AdminProductUpdateRow = ProductUpdate & {
  createdBy: { id: string; email: string };
  _count: { views: number };
};

function toAdminItem(update: AdminProductUpdateRow): AdminProductUpdateItem {
  return {
    id: update.id,
    title: update.title,
    slug: update.slug,
    summary: update.summary,
    description: update.description,
    icon: update.icon,
    status: update.status,
    ctaLabel: update.ctaLabel,
    ctaHref: update.ctaHref,
    publishedAt: update.publishedAt?.toISOString() ?? null,
    createdAt: update.createdAt.toISOString(),
    updatedAt: update.updatedAt.toISOString(),
    viewsCount: update._count.views,
    createdBy: update.createdBy,
    seen: false
  };
}

const adminInclude = {
  createdBy: { select: { id: true, email: true } },
  _count: { select: { views: true } }
} as const;

async function auditProductUpdate(
  action: string,
  update: { id: string; title: string; status: ProductUpdateStatus },
  actor: Actor,
  request?: Request | null
) {
  // Long-form content (summary/description) deliberately stays out of the log.
  await recordAuditEvent({
    actor,
    action,
    category: "ADMIN",
    target: { type: "ProductUpdate", id: update.id, name: update.title },
    metadata: { updateId: update.id, status: update.status },
    request
  });
}

/** Published updates for the What's New page, newest first, with per-user seen flags. */
export async function listPublishedProductUpdates(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {}
) {
  const take = Math.min(Math.max(options.limit ?? PRODUCT_UPDATE_USER_PAGE_SIZE, 1), PRODUCT_UPDATE_USER_MAX_PAGE_SIZE);
  const rows = await prisma.productUpdate.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: { views: { where: { userId }, select: { id: true } } }
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    items: page.map(toPublishedItem),
    nextCursor: hasMore ? page[page.length - 1].id : null
  };
}

/** Efficient indexed count driving the sidebar badge — never scans the view table wholesale. */
export async function countUnseenProductUpdates(userId: string) {
  return prisma.productUpdate.count({
    where: { status: "PUBLISHED", views: { none: { userId } } }
  });
}

/**
 * Idempotent bulk seen write. Only currently PUBLISHED ids are recorded, so
 * drafts/archived ids sent by a client are ignored. userId always comes from
 * the authenticated session, never the request body.
 */
export async function markProductUpdatesSeen(userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  const published = await prisma.productUpdate.findMany({
    where: { status: "PUBLISHED", id: { in: uniqueIds } },
    select: { id: true }
  });

  if (published.length > 0) {
    await prisma.productUpdateView.createMany({
      data: published.map((update) => ({ productUpdateId: update.id, userId })),
      skipDuplicates: true
    });
  }

  return { unseenCount: await countUnseenProductUpdates(userId) };
}

export async function listAdminProductUpdates(options: { cursor?: string | null; limit?: number } = {}) {
  const take = Math.min(Math.max(options.limit ?? PRODUCT_UPDATE_ADMIN_PAGE_SIZE, 1), PRODUCT_UPDATE_ADMIN_MAX_PAGE_SIZE);
  const rows = await prisma.productUpdate.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: adminInclude
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  const [drafts, published, archived, totalViews] = await Promise.all([
    prisma.productUpdate.count({ where: { status: "DRAFT" } }),
    prisma.productUpdate.count({ where: { status: "PUBLISHED" } }),
    prisma.productUpdate.count({ where: { status: "ARCHIVED" } }),
    prisma.productUpdateView.count()
  ]);

  return {
    items: page.map(toAdminItem),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    summary: { drafts, published, archived, totalViews }
  };
}

export async function createProductUpdate(input: ProductUpdateInput, actor: Actor, request?: Request) {
  const update = await prisma.productUpdate.create({
    data: {
      ...input,
      slug: generateProductUpdateSlug(input.title),
      createdById: actor.id
    },
    include: adminInclude
  });

  await auditProductUpdate("product_update.created", update, actor, request);
  return toAdminItem(update);
}

async function requireAdminProductUpdate(id: string) {
  const update = await prisma.productUpdate.findUnique({
    where: { id },
    include: adminInclude
  });

  if (!update) {
    throw new ProductUpdateActionError("Product update not found.", 404);
  }

  return update;
}

export async function getAdminProductUpdate(id: string) {
  return toAdminItem(await requireAdminProductUpdate(id));
}

/** Drafts are fully editable; published updates allow copy corrections. Archived is read-only. */
export async function updateProductUpdate(id: string, input: ProductUpdateInput, actor: Actor, request?: Request) {
  const existing = await requireAdminProductUpdate(id);

  if (existing.status === "ARCHIVED") {
    throw new ProductUpdateActionError("Archived product updates are read-only.");
  }

  const update = await prisma.productUpdate.update({
    where: { id },
    data: input,
    include: adminInclude
  });

  await auditProductUpdate("product_update.updated", update, actor, request);
  return toAdminItem(update);
}

export async function publishProductUpdate(id: string, actor: Actor, request?: Request) {
  const existing = await requireAdminProductUpdate(id);

  if (existing.status === "PUBLISHED") {
    throw new ProductUpdateActionError("This product update is already published.");
  }

  if (existing.status === "ARCHIVED") {
    // No restore/unarchive in v1.
    throw new ProductUpdateActionError("Archived product updates cannot be published again.");
  }

  const update = await prisma.productUpdate.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
    include: adminInclude
  });

  await auditProductUpdate("product_update.published", update, actor, request);
  return toAdminItem(update);
}

export async function archiveProductUpdate(id: string, actor: Actor, request?: Request) {
  const existing = await requireAdminProductUpdate(id);

  if (existing.status === "ARCHIVED") {
    throw new ProductUpdateActionError("This product update is already archived.");
  }

  const update = await prisma.productUpdate.update({
    where: { id },
    data: { status: "ARCHIVED" },
    include: adminInclude
  });

  await auditProductUpdate("product_update.archived", update, actor, request);
  return toAdminItem(update);
}
