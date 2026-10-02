import { AccountDeletionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendDeletionEmail } from "@/lib/account-deletion-email";
import { reporterPseudonym } from "@/lib/incident/identity";
import { assertSafeStorageKey, deleteObject, type StorageBucket } from "@/lib/storage";
import { deletePreparedProspectExportsForUser } from "@/services/prospects/prospect-export";

export class AccountDeletionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Explicit ownership policy. These are private user records; none of the
// DiscoverPublic*, DiscoverProviderBatch*, or shared classification tables are touched.
export const DELETION_POLICY = {
  DELETE: ["Campaign", "CampaignRun", "RecipientJob", "InboundReply", "Import", "ImportColumn", "ImportRow", "Mapping", "Template", "SenderProfile", "Suppression", "SendLedger", "AttachmentAsset", "HunterDomainSearch", "ProspectSearch", "ProspectSearchPerson", "DiscoverSearchExpansion", "ProspectCompany", "ProspectCompanyPosition", "ProspectPerson", "prepared Redis exports", "user-specific RateLimitWindow", "AppNotification", "user-specific communication recipients", "user-owned object storage"],
  ANONYMIZE: ["User tombstone", "AuditLog", "IncidentReport reporter reference"],
  PRESERVE: ["AuditLog events", "AppErrorEvent", "SystemNotice", "ProductUpdateBroadcast", "LegalPolicyNotice", "DiscoverPublicPerson", "DiscoverProviderBatch", "DiscoverProviderBatchPerson", "shared Discover caches and title intelligence"],
} as const;

function deletedEmail(id: string) { return `deleted-${id}@deleted.sendloom.invalid`; }
function deletedLabel(id: string) { return `Deleted account #${id.slice(0, 8)}`; }
function assertUserStorageKey(userId: string, key: string) {
  assertSafeStorageKey(key);
  if (!key.startsWith(`users/${userId}/`)) throw new Error("Deletion object does not belong to this user.");
}

function extractAttachmentPaths(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const attachments = (snapshot as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const path = (item as { storagePath?: unknown }).storagePath;
    return typeof path === "string" ? [path] : [];
  });
}

async function sanitizeAudit(tx: Prisma.TransactionClient, userId: string, email: string) {
  const label = deletedLabel(userId);
  // Legacy rows use actorEmail, often without actorUserId. Search every free-text
  // field too, including JSON metadata and admin events about the subject.
  await tx.$executeRaw`
    UPDATE "AuditLog" SET
      "actorUserId" = CASE WHEN "actorUserId" = ${userId} THEN NULL ELSE "actorUserId" END,
      "actorEmail" = CASE WHEN "actorUserId" = ${userId} OR LOWER("actorEmail") = ${email.toLowerCase()} THEN ${label} ELSE "actorEmail" END,
      "actorName" = NULL, "targetName" = NULL, "message" = NULL,
      "metadata" = NULL, "ipAddress" = NULL, "userAgent" = NULL,
      "entityId" = CASE WHEN "entityId" = ${userId} THEN NULL ELSE "entityId" END
    WHERE "actorUserId" = ${userId} OR LOWER("actorEmail") = ${email.toLowerCase()}
       OR "entityId" = ${userId}
       OR STRPOS(LOWER(COALESCE("actorName", '')), ${email.toLowerCase()}) > 0
       OR STRPOS(LOWER(COALESCE("targetName", '')), ${email.toLowerCase()}) > 0
       OR STRPOS(LOWER(COALESCE("message", '')), ${email.toLowerCase()}) > 0
       OR STRPOS(LOWER(COALESCE("metadata"::text, '')), ${email.toLowerCase()}) > 0
       OR STRPOS(COALESCE("message", ''), ${userId}) > 0
       OR STRPOS(COALESCE("metadata"::text, ''), ${userId}) > 0
  `;
}

async function scrubAccount(tx: Prisma.TransactionClient, id: string, email: string) {
  const now = new Date();
  // Account-only retains private outreach rows and their owner FK. Pending sends
  // are stopped before OAuth credentials are revoked.
  await tx.campaignRun.updateMany({ where: { campaign: { userId: id }, status: { in: ["QUEUED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED"] } }, data: { status: "CANCELLED", completedAt: now } });
  await tx.campaign.updateMany({ where: { userId: id, status: { in: ["SCHEDULED", "WAITING_FOR_SLOT", "RUNNING", "PAUSED"] } }, data: { status: "CANCELLED" } });
  const senders = await tx.senderProfile.findMany({ where: { userId: id }, select: { id: true } });
  for (const sender of senders) {
    await tx.senderProfile.update({ where: { id: sender.id }, data: {
      name: deletedLabel(id), fromEmail: `${sender.id}@deleted.sendloom.invalid`,
      oauthRefreshToken: null, oauthScope: null, providerRef: null,
      lastReplySyncError: null, gmailWatchError: null, metadata: Prisma.JsonNull,
    } });
  }
  await tx.campaign.updateMany({ where: { userId: id }, data: { senderSnapshot: {} } });
  await tx.systemNoticeRecipient.deleteMany({ where: { userId: id } });
  await tx.productUpdateBroadcastRecipient.deleteMany({ where: { userId: id } });
  await tx.legalPolicyNoticeRecipient.deleteMany({ where: { userId: id } });
  await tx.legalPolicyReleaseRecipient.deleteMany({ where: { userId: id } });
  await tx.appNotification.deleteMany({ where: { userId: id } });
  await tx.rateLimitWindow.deleteMany({ where: { OR: [{ windowKey: { contains: email, mode: "insensitive" } }, { windowKey: { contains: id } }] } });
  await sanitizeAudit(tx, id, email);
  await tx.incidentReport.updateMany({ where: { reporterPseudonym: reporterPseudonym(id) }, data: { encryptedReporterRef: null, encryptedReporterIv: null, encryptedReporterTag: null, userNote: null, adminNotes: null } });
  await tx.user.update({ where: { id }, data: {
    email: deletedEmail(id), deletedAt: now, passwordHash: null, googleSub: null,
    magicLinkToken: null, magicLinkExpiry: null, hunterApiKeyEncrypted: null,
    hunterApiKeyLast4: null, hunterApiKeyUpdatedAt: null,
    sessionIssuedAt: now, sessionExpiresAt: null, lastLoginAt: null, lastSeenAt: null,
    profilePhotoKey: null, profilePhotoContentType: null, profilePhotoUpdatedAt: null,
    adultVerifiedAt: null, termsAcceptedAt: null, privacyAcceptedAt: null,
    antiAbuseAcceptedAt: null, policyVersion: null, ageGateVersion: null,
    eligibilityBlockedAt: null, restrictedAt: null,
    apiAccessDisabled: true, importsWriteDisabled: true, templatesWriteDisabled: true,
    launchesDisabled: true, aiEnhancementsDisabled: true,
    restrictedReason: null, eligibilityBlockedReason: null,
  } });
}

export async function deleteAccountOnly(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isAdmin: true, deletedAt: true, profilePhotoKey: true } });
  if (!user || user.deletedAt) throw new AccountDeletionError("Account is no longer available.", 404);
  if (user.isAdmin) throw new AccountDeletionError("Admin accounts cannot use self-service deletion.", 403);
  const active = await prisma.accountDeletionRequest.findUnique({ where: { activeUserId: userId } });
  if (active) throw new AccountDeletionError("A full deletion request is already active.", 409);
  if (user.profilePhotoKey) {
    assertUserStorageKey(userId, user.profilePhotoKey);
    await deleteObject("attachments", user.profilePhotoKey);
  }
  // Conditional update serializes competing deletion clicks and request creation.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({ where: { id: userId, deletedAt: null }, data: { deletedAt: new Date(), sessionExpiresAt: null, apiAccessDisabled: true } });
    if (claimed.count !== 1) throw new AccountDeletionError("Account deletion is already underway.", 409);
    if (await tx.accountDeletionRequest.findUnique({ where: { activeUserId: userId } })) throw new AccountDeletionError("A full deletion request is already active.", 409);
    await scrubAccount(tx, userId, user.email);
    await tx.auditLog.create({ data: { actorEmail: deletedLabel(userId), action: "user.account_deleted", category: "USER", severity: "SECURITY", entityType: "user", message: "Account access removed; outreach records retained." } });
  });
  try { await sendDeletionEmail({ to: user.email, kind: "ACCOUNT_DELETED", idempotencyKey: `account-deleted-${userId}` }); }
  catch { console.error("[account-deletion] Farewell email delivery failed."); }
  return { deleted: true };
}

export async function requestFullDeletion(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isAdmin: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new AccountDeletionError("Account is no longer available.", 404);
  if (user.isAdmin) throw new AccountDeletionError("Admin accounts cannot use self-service deletion.", 403);
  let request = await prisma.accountDeletionRequest.findUnique({ where: { activeUserId: userId } });
  if (!request) {
    try { request = await prisma.$transaction(async (tx) => {
      const locked = await tx.user.updateMany({ where: { id: userId, deletedAt: null }, data: { updatedAt: new Date() } });
      if (!locked.count) throw new AccountDeletionError("Account is no longer available.", 404);
      return tx.accountDeletionRequest.create({ data: { userId, activeUserId: userId } });
    }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      request = await prisma.accountDeletionRequest.findUnique({ where: { activeUserId: userId } });
    }
  }
  if (!request) throw new AccountDeletionError("Could not create deletion request.", 500);
  if (request.status === "PENDING_REVIEW" && !request.requestEmailSentAt) {
    try {
      await sendDeletionEmail({ to: user.email, kind: "REQUEST_RECEIVED", idempotencyKey: `deletion-request-${request.id}` });
      await prisma.accountDeletionRequest.updateMany({ where: { id: request.id, requestEmailSentAt: null }, data: { requestEmailSentAt: new Date() } });
    } catch { console.error("[account-deletion] Request email delivery failed."); }
  }
  return { id: request.id, status: request.status, requestedAt: request.requestedAt.toISOString() };
}

export async function getCurrentDeletionRequest(userId: string) {
  const request = await prisma.accountDeletionRequest.findFirst({ where: { userId }, orderBy: { requestedAt: "desc" }, select: { id: true, status: true, requestedAt: true, completedAt: true } });
  return request ? { ...request, requestedAt: request.requestedAt.toISOString(), completedAt: request.completedAt?.toISOString() ?? null } : null;
}

export async function cancelDeletionRequest(userId: string) {
  const result = await prisma.accountDeletionRequest.updateMany({ where: { activeUserId: userId, status: "PENDING_REVIEW" }, data: { status: "CANCELLED", activeUserId: null } });
  if (!result.count) throw new AccountDeletionError("This request can no longer be cancelled.", 409);
  return { cancelled: true };
}

export async function listDeletionRequests(input: { status?: string; from?: Date; to?: Date; page?: number }) {
  const status = Object.values(AccountDeletionStatus).includes(input.status as AccountDeletionStatus) ? input.status as AccountDeletionStatus : undefined;
  const where: Prisma.AccountDeletionRequestWhereInput = { ...(status ? { status } : {}), ...(input.from || input.to ? { requestedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}) };
  const count = await prisma.accountDeletionRequest.count({ where });
  const page = Math.min(Math.max(Math.floor(input.page || 1), 1), Math.max(1, Math.ceil(count / 20)));
  const items = await prisma.accountDeletionRequest.findMany({ where, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20, include: { user: { select: { email: true, deletedAt: true } }, reviewedByAdmin: { select: { email: true } } } });
  return { items, count, page, pageSize: 20 };
}

export async function getDeletionRequestDetail(id: string) {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id }, include: { user: { select: { email: true, deletedAt: true } }, reviewedByAdmin: { select: { email: true } } } });
  if (!request) return null;
  const userId = request.userId;
  const [sequences, imports, templates, searches, senders, attachments] = await Promise.all([
    prisma.campaign.count({ where: { userId } }), prisma.import.count({ where: { userId } }),
    prisma.template.count({ where: { userId } }), prisma.prospectSearch.count({ where: { userId } }),
    prisma.senderProfile.count({ where: { userId } }), prisma.attachmentAsset.count({ where: { userId } }),
  ]);
  return { ...request, impact: { sequences, imports, templates, searches, senders, attachments } };
}

async function captureObjects(requestId: string, userId: string) {
  const [imports, assets, campaigns, user] = await Promise.all([
    prisma.import.findMany({ where: { userId }, select: { storagePath: true } }),
    prisma.attachmentAsset.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.campaign.findMany({ where: { userId }, select: { templateSnapshot: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { profilePhotoKey: true } }),
  ]);
  const objects = new Map<string, { bucket: StorageBucket; key: string }>();
  for (const item of imports) if (item.storagePath) objects.set(`imports:${item.storagePath}`, { bucket: "imports", key: item.storagePath });
  for (const item of assets) objects.set(`attachments:${item.storageKey}`, { bucket: "attachments", key: item.storageKey });
  for (const item of campaigns) for (const key of extractAttachmentPaths(item.templateSnapshot)) objects.set(`attachments:${key}`, { bucket: "attachments", key });
  if (user?.profilePhotoKey) objects.set(`attachments:${user.profilePhotoKey}`, { bucket: "attachments", key: user.profilePhotoKey });
  if (objects.size) await prisma.accountDeletionObject.createMany({ data: [...objects.values()].map((object) => ({ requestId, ...object })), skipDuplicates: true });
}

async function purgePrivateData(userId: string) {
  await prisma.$transaction(async (tx) => {
    // ProviderEvent and SendLedger have no user FK. Remove provider payloads by
    // message identity before cascading RecipientJob rows.
    await tx.$executeRaw`DELETE FROM "ProviderEvent" WHERE "providerMessageId" IN (SELECT j."providerMessageId" FROM "RecipientJob" j JOIN "CampaignRun" r ON r."id" = j."campaignRunId" JOIN "Campaign" c ON c."id" = r."campaignId" WHERE c."userId" = ${userId} AND j."providerMessageId" IS NOT NULL UNION SELECT l."messageId" FROM "SendLedger" l WHERE l."userId" = ${userId} AND l."messageId" IS NOT NULL)`;
    await tx.$executeRaw`DELETE FROM "SendLedger" WHERE "userId" = ${userId} OR "senderProfileId" IN (SELECT "id" FROM "SenderProfile" WHERE "userId" = ${userId}) OR "campaignId" IN (SELECT "id" FROM "Campaign" WHERE "userId" = ${userId}) OR "recipientJobId" IN (SELECT j."id" FROM "RecipientJob" j JOIN "CampaignRun" r ON r."id" = j."campaignRunId" JOIN "Campaign" c ON c."id" = r."campaignId" WHERE c."userId" = ${userId})`;
    await tx.campaign.deleteMany({ where: { userId } });
    await tx.mapping.deleteMany({ where: { userId } });
    await tx.template.deleteMany({ where: { userId } });
    await tx.import.deleteMany({ where: { userId } });
    await tx.senderProfile.deleteMany({ where: { userId } });
    await tx.suppression.deleteMany({ where: { userId } });
    await tx.hunterDomainSearch.deleteMany({ where: { userId } });
    await tx.discoverSearchExpansion.deleteMany({ where: { userId } });
    await tx.prospectSearchPerson.deleteMany({ where: { userId } });
    await tx.prospectSearch.deleteMany({ where: { userId } });
    await tx.prospectPerson.deleteMany({ where: { userId } });
    await tx.prospectCompany.deleteMany({ where: { userId } });
    await tx.attachmentAsset.deleteMany({ where: { userId } });
    await tx.appNotification.deleteMany({ where: { userId } });
  }, { timeout: 120000 });
}

export async function processFullDeletion(requestId: string, adminId: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { email: true, isAdmin: true, deletedAt: true } });
  if (!admin?.isAdmin || admin.deletedAt) throw new AccountDeletionError("Admin access is required.", 403);
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId }, include: { user: { select: { email: true, deletedAt: true, isAdmin: true } } } });
  if (!request) throw new AccountDeletionError("Deletion request was not found.", 404);
  if (request.status === "COMPLETED") return { status: "COMPLETED" as const };
  if (request.status === "REJECTED" || request.status === "CANCELLED") throw new AccountDeletionError("This request cannot be approved.", 409);
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (request.status === "PROCESSING" && (!request.processingStartedAt || request.processingStartedAt > staleBefore)) throw new AccountDeletionError("Deletion is already processing.", 409);
  if (request.user.isAdmin) throw new AccountDeletionError("Admin accounts cannot be deleted through this workflow.", 403);
  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.accountDeletionRequest.updateMany({ where: { id: requestId, OR: [{ status: { in: ["PENDING_REVIEW", "FAILED"] } }, { status: "PROCESSING", processingStartedAt: { lt: staleBefore } }] }, data: { status: "PROCESSING", reviewedAt: request.reviewedAt ?? new Date(), reviewedByAdminId: adminId, processingStartedAt: new Date(), failureReason: null } });
    if (!updated.count) return false;
    await tx.user.update({ where: { id: request.userId }, data: { deletedAt: new Date(), sessionExpiresAt: null, sessionIssuedAt: new Date(), apiAccessDisabled: true, launchesDisabled: true } });
    await tx.auditLog.create({ data: { actorUserId: adminId, actorEmail: admin.email, action: "admin.account_deletion.approved", category: "ADMIN", severity: "SECURITY", entityType: "account_deletion_request", entityId: requestId, message: "Full deletion approved for processing." } });
    return true;
  });
  if (!claimed) throw new AccountDeletionError("Deletion is already processing.", 409);
  try {
    await captureObjects(requestId, request.userId);
    const objects = await prisma.accountDeletionObject.findMany({ where: { requestId, deletedAt: null } });
    for (const object of objects) {
      if (object.bucket !== "imports" && object.bucket !== "attachments") throw new Error("Invalid deletion object bucket.");
      assertUserStorageKey(request.userId, object.key);
      await deleteObject(object.bucket, object.key);
      await prisma.accountDeletionObject.update({ where: { id: object.id }, data: { deletedAt: new Date() } });
    }
    await deletePreparedProspectExportsForUser(request.userId);
    await purgePrivateData(request.userId);
    if (!request.completionEmailSentAt) {
      try {
        await sendDeletionEmail({ to: request.user.email, kind: "FULL_DELETION_COMPLETE", idempotencyKey: `deletion-complete-${requestId}` });
        await prisma.accountDeletionRequest.update({ where: { id: requestId }, data: { completionEmailSentAt: new Date() } });
      } catch { console.error("[account-deletion] Completion email delivery failed."); }
    }
    await prisma.$transaction(async (tx) => {
      await scrubAccount(tx, request.userId, request.user.email);
      await tx.accountDeletionRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", completedAt: new Date(), activeUserId: null, reviewNote: null } });
      await tx.accountDeletionObject.deleteMany({ where: { requestId } });
      await tx.auditLog.create({ data: { actorEmail: deletedLabel(request.userId), action: "admin.account_deletion.completed", category: "ADMIN", severity: "SECURITY", entityType: "account_deletion_request", entityId: requestId, message: "Private account data removed; audit history retained." } });
    });
    return { status: "COMPLETED" as const };
  } catch (error) {
    await prisma.accountDeletionRequest.updateMany({ where: { id: requestId, status: "PROCESSING" }, data: { status: "FAILED", failureReason: "Deletion processing failed; an admin retry is required." } });
    console.error("[account-deletion] Processing failed.", { requestId, errorName: error instanceof Error ? error.name : "UnknownError" });
    throw new AccountDeletionError("Deletion processing failed. The request can be retried safely.", 500);
  }
}

export async function rejectDeletionRequest(requestId: string, adminId: string, note: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { email: true, isAdmin: true, deletedAt: true } });
  if (!admin?.isAdmin || admin.deletedAt) throw new AccountDeletionError("Admin access is required.", 403);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.accountDeletionRequest.updateMany({ where: { id: requestId, status: "PENDING_REVIEW" }, data: { status: "REJECTED", activeUserId: null, reviewedAt: new Date(), reviewedByAdminId: adminId, reviewNote: note.slice(0, 500) } });
    if (!updated.count) throw new AccountDeletionError("Only pending requests can be rejected.", 409);
    await tx.auditLog.create({ data: { actorUserId: adminId, actorEmail: admin.email, action: "admin.account_deletion.rejected", category: "ADMIN", severity: "SECURITY", entityType: "account_deletion_request", entityId: requestId, message: "Full deletion request rejected." } });
    return { status: "REJECTED" as const };
  });
}
