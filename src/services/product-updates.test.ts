import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyMock,
  countMock,
  createMock,
  updateMock,
  findUniqueMock,
  viewCreateManyMock,
  viewCountMock,
  auditMock
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findUniqueMock: vi.fn(),
  viewCreateManyMock: vi.fn(),
  viewCountMock: vi.fn(),
  auditMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    productUpdate: {
      findMany: findManyMock,
      count: countMock,
      create: createMock,
      update: updateMock,
      findUnique: findUniqueMock
    },
    productUpdateView: {
      createMany: viewCreateManyMock,
      count: viewCountMock
    }
  }
}));

vi.mock("@/lib/audit", () => ({ recordAuditEvent: auditMock }));

import { ProductUpdateActionError } from "@/lib/product-updates";
import {
  archiveProductUpdate,
  countUnseenProductUpdates,
  createProductUpdate,
  listPublishedProductUpdates,
  markProductUpdatesSeen,
  publishProductUpdate,
  updateProductUpdate
} from "@/services/product-updates";

const actor = { id: "admin-1", email: "admin@example.com" };

const input = {
  title: "Make your Sendloom account yours",
  summary: "You can now upload a personal profile photo.",
  description: "Add, change, or remove your profile photo from Account settings.",
  icon: "USER" as const,
  ctaLabel: "Add profile photo",
  ctaHref: "/account"
};

function adminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "update-1",
    title: input.title,
    slug: "make-your-sendloom-account-yours-12345678",
    summary: input.summary,
    description: input.description,
    icon: "USER",
    status: "DRAFT",
    ctaLabel: input.ctaLabel,
    ctaHref: input.ctaHref,
    publishedAt: null,
    createdAt: new Date("2026-08-26T12:00:00Z"),
    updatedAt: new Date("2026-08-26T12:00:00Z"),
    createdById: actor.id,
    createdBy: { id: actor.id, email: actor.email },
    _count: { views: 0 },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPublishedProductUpdates", () => {
  it("queries only PUBLISHED updates, newest published first, with the user's seen rows", async () => {
    findManyMock.mockResolvedValue([
      { id: "u1", title: "Newer", publishedAt: new Date("2026-08-26T00:00:00Z"), views: [{ id: "v1" }] },
      { id: "u2", title: "Older", publishedAt: new Date("2026-08-20T00:00:00Z"), views: [] }
    ]);

    const page = await listPublishedProductUpdates("user-1", { limit: 10 });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PUBLISHED" },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 11,
        include: { views: { where: { userId: "user-1" }, select: { id: true } } }
      })
    );
    expect(page.items[0]).toMatchObject({ id: "u1", seen: true });
    expect(page.items[1]).toMatchObject({ id: "u2", seen: false });
    expect(page.nextCursor).toBeNull();
  });

  it("paginates with a keyset cursor", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        id: `u${index}`,
        publishedAt: new Date("2026-08-26T00:00:00Z"),
        views: []
      }))
    );

    const page = await listPublishedProductUpdates("user-1", { limit: 2, cursor: "u9" });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "u9" }, skip: 1, take: 3 })
    );
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("u1");
  });
});

describe("countUnseenProductUpdates", () => {
  it("counts published updates with no view row for the user", async () => {
    countMock.mockResolvedValue(2);

    await expect(countUnseenProductUpdates("user-1")).resolves.toBe(2);
    expect(countMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", views: { none: { userId: "user-1" } } }
    });
  });
});

describe("markProductUpdatesSeen", () => {
  it("records only currently published ids for the session user, idempotently", async () => {
    findManyMock.mockResolvedValue([{ id: "pub-1" }]);
    countMock.mockResolvedValue(0);

    const result = await markProductUpdatesSeen("user-1", ["pub-1", "draft-1", "pub-1"]);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { status: "PUBLISHED", id: { in: ["pub-1", "draft-1"] } },
      select: { id: true }
    });
    expect(viewCreateManyMock).toHaveBeenCalledWith({
      data: [{ productUpdateId: "pub-1", userId: "user-1" }],
      skipDuplicates: true
    });
    expect(result).toEqual({ unseenCount: 0 });
  });

  it("skips the write entirely when nothing supplied is published", async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await markProductUpdatesSeen("user-1", ["draft-1"]);
    expect(viewCreateManyMock).not.toHaveBeenCalled();
  });

  it("never writes seen rows for another user", async () => {
    findManyMock.mockResolvedValue([{ id: "pub-1" }]);
    countMock.mockResolvedValue(0);

    await markProductUpdatesSeen("user-a", ["pub-1"]);
    const data = viewCreateManyMock.mock.calls[0][0].data;
    expect(data.every((row: { userId: string }) => row.userId === "user-a")).toBe(true);
  });
});

describe("createProductUpdate", () => {
  it("creates a draft with a generated slug and audits the action without content", async () => {
    createMock.mockResolvedValue(adminRow());

    const created = await createProductUpdate(input, actor);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: input.title,
          slug: expect.stringMatching(/^make-your-sendloom-account-yours-[a-f0-9]{8}$/),
          createdById: actor.id
        })
      })
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product_update.created",
        category: "ADMIN",
        metadata: expect.not.objectContaining({ description: expect.anything() })
      })
    );
    expect(created.status).toBe("DRAFT");
  });
});

describe("updateProductUpdate", () => {
  it("allows editing a draft", async () => {
    findUniqueMock.mockResolvedValue(adminRow());
    updateMock.mockResolvedValue(adminRow({ title: "Updated title" }));

    const updated = await updateProductUpdate("update-1", { ...input, title: "Updated title" }, actor);
    expect(updateMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "product_update.updated" }));
    expect(updated.title).toBe("Updated title");
  });

  it("makes archived updates read-only", async () => {
    findUniqueMock.mockResolvedValue(adminRow({ status: "ARCHIVED" }));

    await expect(updateProductUpdate("update-1", input, actor)).rejects.toMatchObject({
      message: "Archived product updates are read-only."
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("publishProductUpdate", () => {
  it("sets status PUBLISHED and stamps publishedAt with server time", async () => {
    findUniqueMock.mockResolvedValue(adminRow());
    const publishedAt = new Date("2026-08-26T15:00:00Z");
    updateMock.mockResolvedValue(adminRow({ status: "PUBLISHED", publishedAt }));

    const published = await publishProductUpdate("update-1", actor);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED", publishedAt: expect.any(Date) })
      })
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "product_update.published" }));
    expect(published.publishedAt).toBe(publishedAt.toISOString());
  });

  it("rejects publishing twice and publishing from the archive", async () => {
    findUniqueMock.mockResolvedValueOnce(adminRow({ status: "PUBLISHED" }));
    await expect(publishProductUpdate("update-1", actor)).rejects.toBeInstanceOf(ProductUpdateActionError);

    findUniqueMock.mockResolvedValueOnce(adminRow({ status: "ARCHIVED" }));
    await expect(publishProductUpdate("update-1", actor)).rejects.toMatchObject({
      message: "Archived product updates cannot be published again."
    });

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("archiveProductUpdate", () => {
  it("archives a published update and audits it", async () => {
    findUniqueMock.mockResolvedValue(adminRow({ status: "PUBLISHED" }));
    updateMock.mockResolvedValue(adminRow({ status: "ARCHIVED" }));

    const archived = await archiveProductUpdate("update-1", actor);

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ARCHIVED" } }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "product_update.archived" }));
    expect(archived.status).toBe("ARCHIVED");
  });

  it("is not idempotent — a second archive is a conflict, and unknown ids are 404", async () => {
    findUniqueMock.mockResolvedValueOnce(adminRow({ status: "ARCHIVED" }));
    await expect(archiveProductUpdate("update-1", actor)).rejects.toMatchObject({
      message: "This product update is already archived."
    });

    findUniqueMock.mockResolvedValueOnce(null);
    await expect(archiveProductUpdate("missing", actor)).rejects.toMatchObject({ status: 404 });
  });
});
