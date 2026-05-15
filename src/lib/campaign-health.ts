import type { FailureCheckResult } from "@/lib/failures";

export type CampaignHealthStatus = "HEALTHY" | "WARNING" | "NEEDS_ATTENTION" | "BLOCKED" | "STUCK" | "FAILED";

export type CampaignValidationSummary = {
  blockers: number;
  errors: number;
  warnings: number;
  info: number;
};

export type CampaignHealthInput = {
  campaignStatus?: string | null;
  runStatus?: string | null;
  pendingRecipients: number;
  failedRecipients: number;
  invalidRecipients: number;
  suppressedRecipients: number;
  retryableFailureCount: number;
  validationSummary?: CampaignValidationSummary | null;
  validationChecks?: FailureCheckResult[] | null;
  lastActivityAt?: Date | null;
  lastReplySyncError?: string | null;
  gmailWarning?: boolean;
  now?: Date;
};

const DEFAULT_STUCK_THRESHOLD_MINUTES = 20;

export function isCampaignStuck(args: {
  campaignStatus?: string | null;
  runStatus?: string | null;
  pendingRecipients: number;
  lastActivityAt?: Date | null;
  now?: Date;
  thresholdMinutes?: number;
}) {
  const active = args.campaignStatus === "RUNNING" || args.runStatus === "RUNNING" || args.runStatus === "QUEUED";
  if (!active || args.pendingRecipients <= 0 || !args.lastActivityAt) {
    return false;
  }

  const thresholdMinutes = args.thresholdMinutes ?? DEFAULT_STUCK_THRESHOLD_MINUTES;
  const now = args.now ?? new Date();
  return now.getTime() - args.lastActivityAt.getTime() >= thresholdMinutes * 60_000;
}

export function calculateCampaignHealth(input: CampaignHealthInput) {
  const validationSummary = input.validationSummary ?? {
    blockers: 0,
    errors: 0,
    warnings: 0,
    info: 0
  };
  const stuck = isCampaignStuck({
    campaignStatus: input.campaignStatus,
    runStatus: input.runStatus,
    pendingRecipients: input.pendingRecipients,
    lastActivityAt: input.lastActivityAt,
    now: input.now
  });

  let status: CampaignHealthStatus = "HEALTHY";

  if (input.campaignStatus === "FAILED" || input.runStatus === "FAILED") {
    status = "FAILED";
  } else if (stuck) {
    status = "STUCK";
  } else if (validationSummary.blockers > 0) {
    status = "BLOCKED";
  } else if (
    input.failedRecipients > 0 ||
    input.invalidRecipients > 0 ||
    Boolean(input.lastReplySyncError) ||
    Boolean(input.gmailWarning)
  ) {
    status = "NEEDS_ATTENTION";
  } else if (validationSummary.warnings > 0 || input.retryableFailureCount > 0 || input.suppressedRecipients > 0) {
    status = "WARNING";
  }

  return {
    status,
    stuck,
    validationSummary
  };
}

export function getValidationSummaryFromSnapshot(snapshot: unknown): CampaignValidationSummary {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      blockers: 0,
      errors: 0,
      warnings: 0,
      info: 0
    };
  }

  const summary = (snapshot as { summary?: Partial<CampaignValidationSummary> }).summary;
  return {
    blockers: typeof summary?.blockers === "number" ? summary.blockers : 0,
    errors: typeof summary?.errors === "number" ? summary.errors : 0,
    warnings: typeof summary?.warnings === "number" ? summary.warnings : 0,
    info: typeof summary?.info === "number" ? summary.info : 0
  };
}

export function getValidationChecksFromSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [] as FailureCheckResult[];
  }

  const checks = (snapshot as { checks?: unknown }).checks;
  return Array.isArray(checks) ? (checks as FailureCheckResult[]) : [];
}
