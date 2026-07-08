// Reclassification of recipient jobs whose stored evidence proves the
// recipient ADDRESS was invalid (an address-quality outcome, never a Sendloom
// failure) but whose status still hides that from the rollups: generic FAILED
// rows, legacy BOUNCED rows, and falsely-delivered SENT/OPENED rows (a bounce
// confirmed the address after the send, but the job kept — or was flipped
// back to — a delivery status by a false pixel "open"). Used by the
// scripts/reclassify-invalid-recipient-bounces.ts backfill.
//
// Evidence is read only from safe, already-sanitized fields (classifier
// categories, failure codes, bounded provider diagnostics, lastError) — never
// from raw Gmail bodies. Detection is signature-based and provider-agnostic:
// no company, domain, or recipient is ever special-cased.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { safeDeliveryFailureReason, type DeliveryFailureCategory } from "@/lib/gmail-dsn";
import { getEnhancedStatusCodeFromText, isInvalidRecipientDiagnosticText } from "@/lib/gmail-errors";
import { syncRunCounts } from "@/services/campaigns";
import { recordInvalidRecipientSuppression } from "@/services/suppressions";

export const RECLASSIFICATION_SUPPRESSION_SOURCE = "gmail-bounce-reclassification";

const DEFAULT_SCAN_LIMIT = 1_000;

export type InvalidRecipientEvidence = {
  failureCategory: DeliveryFailureCategory;
  enhancedStatusCode: string | null;
  /** Which stored signal proved the address invalid (for reporting only). */
  evidenceSource: "bounce-metadata" | "provider-diagnostic" | "existing-suppression";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const HARD_BOUNCE_CATEGORIES: ReadonlySet<string> = new Set([
  "HARD_BOUNCE_INVALID_RECIPIENT",
  "HARD_BOUNCE_MAILBOX_NOT_FOUND",
  "HARD_BOUNCE_DOMAIN_NOT_FOUND",
  "HARD_BOUNCE_PERMANENT_MAILBOX_FAILURE"
]);

/**
 * Inspect one FAILED job's stored fields for proof of an invalid recipient
 * address. Conservative by design: generic rejections ("Gmail rejected this
 * recipient."), policy/spam bounces, rate limits, OAuth and attachment errors
 * carry none of these signatures and never match.
 */
export function findInvalidRecipientEvidence(job: {
  metadata: unknown;
  lastError: string | null;
}): InvalidRecipientEvidence | null {
  const metadata = asRecord(job.metadata);
  const failureCategory = readString(metadata.failureCategory);
  const failureCode = readString(metadata.failureCode);

  // 1. The job already carries hard-bounce classification (written by the DSN
  //    processor or the send-time rejection path) but kept a FAILED status.
  if (failureCode === "HARD_BOUNCE_RECIPIENT" || (failureCategory && HARD_BOUNCE_CATEGORIES.has(failureCategory))) {
    const category =
      failureCategory && HARD_BOUNCE_CATEGORIES.has(failureCategory)
        ? (failureCategory as DeliveryFailureCategory)
        : "HARD_BOUNCE_INVALID_RECIPIENT";
    return {
      failureCategory: category,
      enhancedStatusCode: readString(metadata.enhancedStatusCode),
      evidenceSource: "bounce-metadata"
    };
  }

  // 2. The sanitized provider diagnostic (or the stored lastError) names the
  //    recipient address as the problem.
  const lastInternalError = asRecord(metadata.lastInternalError);
  const diagnosticText = [
    readString(metadata.providerErrorMessage),
    readString(lastInternalError.message),
    readString(job.lastError)
  ]
    .filter(Boolean)
    .join(" ");
  if (diagnosticText && isInvalidRecipientDiagnosticText(diagnosticText)) {
    return {
      failureCategory: "HARD_BOUNCE_INVALID_RECIPIENT",
      enhancedStatusCode: getEnhancedStatusCodeFromText(diagnosticText),
      evidenceSource: "provider-diagnostic"
    };
  }

  return null;
}

export type ReclassificationCandidate = {
  jobId: string;
  campaignRunId: string;
  userId: string | null;
  email: string;
  /** Status the row held before reclassification (for reporting). */
  previousStatus: string;
  evidence: InvalidRecipientEvidence;
};

export type ReclassificationResult = {
  scanned: number;
  candidates: ReclassificationCandidate[];
  reclassifiedCount: number;
  suppressionsRecordedCount: number;
};

// FAILED and BOUNCED rows may be reclassified from any stored evidence
// (metadata, provider diagnostics, or an existing invalid-address
// suppression). SENT/OPENED rows are treated as delivered unless STRONG
// evidence proves otherwise: hard-bounce metadata written by the DSN healer,
// or a confirmed invalid-address suppression for this exact user + email.
// Free-text diagnostics never demote a delivery status, and a row with a real
// reply is never touched. CLICKED rows are never scanned.
const SCANNED_STATUSES = ["FAILED", "BOUNCED", "SENT", "OPENED"] as const;
const DELIVERY_STATUSES: ReadonlySet<string> = new Set(["SENT", "OPENED"]);

/**
 * Scan FAILED/BOUNCED/SENT/OPENED recipient jobs and reclassify the
 * provably-invalid ones to the Skipped (SUPPRESSED) disposition, recording an
 * INVALID_EMAIL suppression so every future send skips the address before
 * calling Gmail, then resyncing every touched run's rollup counters.
 *
 * Idempotent: reclassified rows leave the scanned filters, and suppressions
 * are upserted once per (user, email) per run. Dry-run (apply: false) only
 * reports. A job whose address the user has ALREADY suppressed as invalid
 * (HARD_BOUNCE / INVALID_EMAIL) also qualifies — that covers bounces the DSN
 * processor confirmed but could not apply to the job at the time (for example
 * a row a false pixel "open" had flipped to OPENED).
 */
export async function reclassifyInvalidRecipientJobs(options: {
  apply: boolean;
  userId?: string;
  campaignId?: string;
  limit?: number;
}): Promise<ReclassificationResult> {
  const jobs = await prisma.recipientJob.findMany({
    where: {
      status: { in: [...SCANNED_STATUSES] },
      campaignRun: {
        campaign: {
          ...(options.campaignId ? { id: options.campaignId } : {}),
          ...(options.userId ? { userId: options.userId } : {})
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: options.limit ?? DEFAULT_SCAN_LIMIT,
    select: {
      id: true,
      campaignRunId: true,
      recipientEmail: true,
      status: true,
      replyCount: true,
      lastError: true,
      metadata: true,
      campaignRun: { select: { campaign: { select: { userId: true, senderProfile: { select: { userId: true } } } } } }
    }
  });

  // Existing invalid-address suppressions count as evidence for jobs the DSN
  // path confirmed but could not update.
  const emails = [...new Set(jobs.map((job) => job.recipientEmail.trim().toLowerCase()))];
  const suppressions = emails.length
    ? await prisma.suppression.findMany({
        where: { email: { in: emails }, reason: { in: ["HARD_BOUNCE", "INVALID_EMAIL"] } },
        select: { userId: true, email: true, failureCategory: true, enhancedStatusCode: true }
      })
    : [];
  const suppressionByUserEmail = new Map(
    suppressions.map((row) => [`${row.userId}:${row.email.trim().toLowerCase()}`, row] as const)
  );

  const candidates: ReclassificationCandidate[] = [];
  for (const job of jobs) {
    const userId = job.campaignRun.campaign.userId ?? job.campaignRun.campaign.senderProfile.userId ?? null;
    const email = job.recipientEmail.trim().toLowerCase();
    const isDeliveryStatus = DELIVERY_STATUSES.has(job.status);

    // A recorded reply is strong evidence the message really reached a person
    // — a delivered row with replies is never demoted.
    if (isDeliveryStatus && job.replyCount > 0) {
      continue;
    }

    let evidence = findInvalidRecipientEvidence(job);
    // Free-text diagnostics are enough to relabel a FAILED/BOUNCED row, but
    // never to demote a delivery status — SENT/OPENED rows require the
    // hard-bounce classification written by the DSN/send-rejection paths.
    if (evidence && isDeliveryStatus && evidence.evidenceSource !== "bounce-metadata") {
      evidence = null;
    }
    if (!evidence && userId) {
      const suppression = suppressionByUserEmail.get(`${userId}:${email}`);
      if (suppression) {
        const category = suppression.failureCategory;
        evidence = {
          failureCategory:
            category && HARD_BOUNCE_CATEGORIES.has(category)
              ? (category as DeliveryFailureCategory)
              : "HARD_BOUNCE_INVALID_RECIPIENT",
          enhancedStatusCode: suppression.enhancedStatusCode,
          evidenceSource: "existing-suppression"
        };
      }
    }
    if (evidence) {
      candidates.push({
        jobId: job.id,
        campaignRunId: job.campaignRunId,
        userId,
        email,
        previousStatus: job.status,
        evidence
      });
    }
  }

  if (!options.apply || candidates.length === 0) {
    return { scanned: jobs.length, candidates, reclassifiedCount: 0, suppressionsRecordedCount: 0 };
  }

  const jobsById = new Map(jobs.map((job) => [job.id, job] as const));
  const suppressedPairs = new Set<string>();
  let suppressionsRecordedCount = 0;

  for (const candidate of candidates) {
    // One suppression upsert per (user, email) per run — several failed jobs
    // to the same address never inflate the failure counter.
    const pairKey = `${candidate.userId}:${candidate.email}`;
    if (candidate.userId && !suppressedPairs.has(pairKey)) {
      suppressedPairs.add(pairKey);
      await recordInvalidRecipientSuppression({
        userId: candidate.userId,
        email: candidate.email,
        source: RECLASSIFICATION_SUPPRESSION_SOURCE,
        failureCategory: candidate.evidence.failureCategory,
        enhancedStatusCode: candidate.evidence.enhancedStatusCode
      });
      suppressionsRecordedCount += 1;
    }

    const currentMetadata = asRecord(jobsById.get(candidate.jobId)?.metadata);
    await prisma.recipientJob.update({
      where: { id: candidate.jobId },
      data: {
        status: "SUPPRESSED",
        nextRetryAt: null,
        lastError: safeDeliveryFailureReason(candidate.evidence.failureCategory),
        metadata: {
          ...currentMetadata,
          failureCode: "HARD_BOUNCE_RECIPIENT",
          failureCategory: candidate.evidence.failureCategory,
          enhancedStatusCode: candidate.evidence.enhancedStatusCode,
          retryable: false
        } as Prisma.InputJsonValue
      }
    });
  }

  for (const runId of new Set(candidates.map((candidate) => candidate.campaignRunId))) {
    await syncRunCounts(runId);
  }

  return {
    scanned: jobs.length,
    candidates,
    reclassifiedCount: candidates.length,
    suppressionsRecordedCount
  };
}
