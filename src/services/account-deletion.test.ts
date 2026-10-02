import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const calls = {
    userFindUnique: vi.fn(), activeFindUnique: vi.fn(), requestFindUnique: vi.fn(),
    userUpdateMany: vi.fn(), senderFindMany: vi.fn(), senderUpdate: vi.fn(),
    campaignRunUpdateMany: vi.fn(), campaignUpdateMany: vi.fn(),
    noticeDeleteMany: vi.fn(), productDeleteMany: vi.fn(), legalNoticeDeleteMany: vi.fn(), legalReleaseDeleteMany: vi.fn(), notificationDeleteMany: vi.fn(),
    auditCreate: vi.fn(), executeRaw: vi.fn(), incidentUpdateMany: vi.fn(), userUpdate: vi.fn(),
    transaction: vi.fn(), mail: vi.fn(), storageDelete: vi.fn(),
    requestUpdateMany: vi.fn(), requestUpdate: vi.fn(), requestCreate: vi.fn(),
    objectCreateMany: vi.fn(), objectFindMany: vi.fn(), objectUpdate: vi.fn(), objectDeleteMany: vi.fn(),
    importFindMany: vi.fn(), assetFindMany: vi.fn(), campaignFindMany: vi.fn(),
    campaignDeleteMany: vi.fn(), prospectSearchDeleteMany: vi.fn(),
  };
  return calls;
});

const tx = {
  user: { updateMany: mocks.userUpdateMany, update: mocks.userUpdate },
  accountDeletionRequest: { findUnique: mocks.activeFindUnique, updateMany: mocks.requestUpdateMany, update: mocks.requestUpdate, create: mocks.requestCreate },
  campaignRun: { updateMany: mocks.campaignRunUpdateMany }, campaign: { updateMany: mocks.campaignUpdateMany, deleteMany: mocks.campaignDeleteMany },
  senderProfile: { findMany: mocks.senderFindMany, update: mocks.senderUpdate, deleteMany: vi.fn() },
  systemNoticeRecipient: { deleteMany: mocks.noticeDeleteMany }, productUpdateBroadcastRecipient: { deleteMany: mocks.productDeleteMany },
  legalPolicyNoticeRecipient: { deleteMany: mocks.legalNoticeDeleteMany }, legalPolicyReleaseRecipient: { deleteMany: mocks.legalReleaseDeleteMany },
  appNotification: { deleteMany: mocks.notificationDeleteMany }, auditLog: { create: mocks.auditCreate },
  rateLimitWindow: { deleteMany: vi.fn() },
  incidentReport: { updateMany: mocks.incidentUpdateMany }, $executeRaw: mocks.executeRaw,
  mapping: { deleteMany: vi.fn() }, template: { deleteMany: vi.fn() }, import: { deleteMany: vi.fn() },
  suppression: { deleteMany: vi.fn() }, hunterDomainSearch: { deleteMany: vi.fn() },
  discoverSearchExpansion: { deleteMany: vi.fn() }, prospectSearchPerson: { deleteMany: vi.fn() },
  prospectSearch: { deleteMany: mocks.prospectSearchDeleteMany }, prospectPerson: { deleteMany: vi.fn() },
  prospectCompany: { deleteMany: vi.fn() }, attachmentAsset: { deleteMany: vi.fn() },
  accountDeletionObject: { deleteMany: mocks.objectDeleteMany },
};
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.userFindUnique },
  accountDeletionRequest: { findUnique: mocks.requestFindUnique, update: mocks.requestUpdate, updateMany: mocks.requestUpdateMany },
  accountDeletionObject: { createMany: mocks.objectCreateMany, findMany: mocks.objectFindMany, update: mocks.objectUpdate },
  import: { findMany: mocks.importFindMany }, attachmentAsset: { findMany: mocks.assetFindMany },
  campaign: { findMany: mocks.campaignFindMany },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/account-deletion-email", () => ({ sendDeletionEmail: mocks.mail }));
vi.mock("@/lib/storage", () => ({ deleteObject: mocks.storageDelete, assertSafeStorageKey: vi.fn() }));
vi.mock("@/lib/incident/identity", () => ({ reporterPseudonym: () => "U-TEST" }));
vi.mock("@/services/prospects/prospect-export", () => ({ deletePreparedProspectExportsForUser: vi.fn() }));

import { DELETION_POLICY, deleteAccountOnly, processFullDeletion, requestFullDeletion } from "./account-deletion";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((fn) => fn(tx));
  mocks.userFindUnique.mockResolvedValue({ email: "person@example.com", isAdmin: false, deletedAt: null, profilePhotoKey: null });
  mocks.requestFindUnique.mockResolvedValue(null);
  mocks.activeFindUnique.mockResolvedValue(null);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.senderFindMany.mockResolvedValue([]);
  mocks.importFindMany.mockResolvedValue([]);
  mocks.assetFindMany.mockResolvedValue([]);
  mocks.campaignFindMany.mockResolvedValue([]);
  mocks.objectFindMany.mockResolvedValue([]);
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 });
});

describe("account deletion policy", () => {
  it("keeps audit history and shared Discover knowledge out of the delete set", () => {
    expect(DELETION_POLICY.PRESERVE).toContain("AuditLog events");
    expect(DELETION_POLICY.PRESERVE).toContain("DiscoverPublicPerson");
    expect(DELETION_POLICY.DELETE).not.toContain("AuditLog");
  });
  it("revokes identity and sessions while retaining outreach rows for account-only deletion", async () => {
    await expect(deleteAccountOnly("user-1")).resolves.toEqual({ deleted: true });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: null, googleSub: null, sessionExpiresAt: null, deletedAt: expect.any(Date) }) }));
    expect(mocks.campaignUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { senderSnapshot: {} } }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "user.account_deleted" }) }));
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1); // sanitized in place, never deleted
    expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: "person@example.com", kind: "ACCOUNT_DELETED", idempotencyKey: "account-deleted-user-1" });
  });
  it("blocks account-only deletion when a full request is active", async () => {
    mocks.requestFindUnique.mockResolvedValue({ id: "request-1" });
    await expect(deleteAccountOnly("user-1")).rejects.toMatchObject({ status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.mail).not.toHaveBeenCalled();
  });
  it("reuses an existing active full request without a second record or email", async () => {
    const requestedAt = new Date("2026-10-01T12:00:00Z");
    mocks.requestFindUnique.mockResolvedValue({ id: "request-1", status: "PENDING_REVIEW", requestedAt, requestEmailSentAt: new Date() });
    await expect(requestFullDeletion("user-1")).resolves.toEqual({ id: "request-1", status: "PENDING_REVIEW", requestedAt: requestedAt.toISOString() });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.mail).not.toHaveBeenCalled();
  });
  it("does not process a completed or rejected request again", async () => {
    mocks.userFindUnique.mockResolvedValue({ email: "admin@example.com", isAdmin: true, deletedAt: null });
    mocks.requestFindUnique.mockResolvedValue({ id: "request-1", status: "COMPLETED", user: { isAdmin: false } });
    await expect(processFullDeletion("request-1", "admin-1")).resolves.toEqual({ status: "COMPLETED" });
    mocks.requestFindUnique.mockResolvedValue({ id: "request-1", status: "REJECTED", user: { isAdmin: false } });
    await expect(processFullDeletion("request-1", "admin-1")).rejects.toMatchObject({ status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("purges private records and owned storage while keeping audit events", async () => {
    mocks.userFindUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
      where.id === "admin-1"
        ? { email: "admin@example.com", isAdmin: true, deletedAt: null }
        : { email: "person@example.com", isAdmin: false, deletedAt: null, profilePhotoKey: null }
    ));
    mocks.requestFindUnique.mockResolvedValue({
      id: "request-1", userId: "user-1", status: "PENDING_REVIEW", reviewedAt: null,
      completionEmailSentAt: null, user: { email: "person@example.com", isAdmin: false, deletedAt: null },
    });
    mocks.importFindMany.mockResolvedValue([{ storagePath: "users/user-1/imports/import-1.csv" }]);
    mocks.objectFindMany.mockResolvedValue([{ id: "object-1", bucket: "imports", key: "users/user-1/imports/import-1.csv" }]);

    await expect(processFullDeletion("request-1", "admin-1")).resolves.toEqual({ status: "COMPLETED" });
    expect(mocks.objectCreateMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ requestId: "request-1", key: "users/user-1/imports/import-1.csv" })] }));
    expect(mocks.storageDelete).toHaveBeenCalledExactlyOnceWith("imports", "users/user-1/imports/import-1.csv");
    expect(mocks.objectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: expect.any(Date) } }));
    expect(mocks.campaignDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.prospectSearchDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.mail).toHaveBeenCalledExactlyOnceWith({ to: "person@example.com", kind: "FULL_DELETION_COMPLETE", idempotencyKey: "deletion-complete-request-1" });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "admin.account_deletion.approved" }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "admin.account_deletion.completed" }) }));
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3); // provider events, send ledger, then in-place audit sanitization
    expect(mocks.objectDeleteMany).toHaveBeenCalledWith({ where: { requestId: "request-1" } });
  });
});
