import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";

import { createFailureCheck, type FailureCheckResult } from "@/lib/failures";
import { buildMergePayload } from "@/lib/mapping";
import { getNextRunDate } from "@/lib/schedule";
import { extractTemplateVariables, renderTemplate, renderTemplateContent, type TemplateFormat } from "@/lib/templates";
import type { CampaignValidationReport, CampaignValidationSummary, ValidationIssue } from "@/lib/types";
import { isValidEmail } from "@/lib/utils";

type ValidationParams = {
  rows: Array<{ rowIndex: number; email: string | null; payload: Record<string, unknown> }>;
  templateSubject: string;
  templateHtml: string;
  suppressedEmails: Set<string>;
};

type CampaignAttachmentValidationRecord = {
  fileName?: string | null;
  storagePath?: string | null;
  contentBase64?: string | null;
};

type StructuredValidationParams = {
  campaignId: string;
  userId?: string | null;
  senderProfile?: {
    userId?: string | null;
    fromEmail?: string | null;
    oauthRefreshToken?: string | null;
    provider?: string | null;
  } | null;
  importRecord?: {
    rowCount?: number | null;
    rows: Array<{ rowIndex: number; email: string | null; normalized: Record<string, unknown> }>;
    columns: Array<{ normalized: string }>;
  } | null;
  mappingRecord?: {
    userId?: string | null;
    importId?: string | null;
  } | null;
  templateRecord?: {
    userId?: string | null;
  } | null;
  templateSnapshot?: {
    subject?: string | null;
    format?: TemplateFormat | null;
    htmlBody?: string | null;
    attachments?: CampaignAttachmentValidationRecord[] | null;
  } | null;
  mappingSnapshot?: {
    reservedFieldMap?: Record<string, string>;
    variableMap?: Record<string, string>;
  } | null;
  scheduleType?: string | null;
  scheduleConfig?: unknown;
  suppressionReasons?: Map<string, string>;
  report: CampaignValidationReport;
  systemHealth?: {
    checks: {
      database: { status: "ok" | "down" };
      redis: { status: "ok" | "down" };
      appBaseUrl: { status: "configured" | "missing" };
      sessionSecret: { status: "configured" | "missing" };
      googleOAuth: { status: "configured" | "missing" };
      cron: { status: "configured" | "missing" };
    };
  };
  now?: Date;
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function buildValidationReport(params: ValidationParams): CampaignValidationReport {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const requiredVariables = new Set([
    ...extractTemplateVariables(params.templateSubject),
    ...extractTemplateVariables(params.templateHtml)
  ]);

  let validRecipients = 0;
  let invalidRecipients = 0;
  let suppressedRecipients = 0;
  let duplicateRecipients = 0;

  for (const row of params.rows) {
    const email = row.email?.trim().toLowerCase() ?? null;

    if (!email) {
      invalidRecipients += 1;
      issues.push({ code: "MISSING_EMAIL", message: "Recipient email is missing.", rowIndex: row.rowIndex });
      continue;
    }

    if (!isValidEmail(email)) {
      invalidRecipients += 1;
      issues.push({ code: "INVALID_EMAIL", message: "Recipient email is invalid.", rowIndex: row.rowIndex, email });
      continue;
    }

    if (seen.has(email)) {
      duplicateRecipients += 1;
      issues.push({ code: "DUPLICATE_EMAIL", message: "Duplicate email in import.", rowIndex: row.rowIndex, email });
      continue;
    }

    seen.add(email);

    if (params.suppressedEmails.has(email)) {
      suppressedRecipients += 1;
      issues.push({ code: "SUPPRESSED", message: "Recipient is on the suppression list.", rowIndex: row.rowIndex, email });
      continue;
    }

    for (const variable of requiredVariables) {
      if (!(variable in row.payload)) {
        issues.push({
          code: "MISSING_VARIABLE",
          message: `Template variable "${variable}" is missing in mapped data.`,
          rowIndex: row.rowIndex,
          email
        });
      }
    }

    validRecipients += 1;
  }

  const estimatedDurationMinutes = Math.ceil(validRecipients / 120);

  return {
    validRecipients,
    invalidRecipients,
    suppressedRecipients,
    duplicateRecipients,
    estimatedDurationMinutes,
    issues
  };
}

function summarizeFailureChecks(checks: FailureCheckResult[]): CampaignValidationSummary {
  return checks.reduce(
    (summary, check) => {
      if (check.severity === "BLOCKER") {
        summary.blockers += 1;
      } else if (check.severity === "ERROR") {
        summary.errors += 1;
      } else if (check.severity === "WARNING") {
        summary.warnings += 1;
      } else {
        summary.info += 1;
      }

      return summary;
    },
    {
      blockers: 0,
      errors: 0,
      warnings: 0,
      info: 0
    }
  );
}

function getMappedFieldNames(mappingSnapshot?: StructuredValidationParams["mappingSnapshot"]) {
  return new Set(
    Object.values({
      ...(mappingSnapshot?.variableMap ?? {}),
      ...(mappingSnapshot?.reservedFieldMap ?? {})
    }).filter(Boolean)
  );
}

function getTemplateVariables(templateSnapshot?: StructuredValidationParams["templateSnapshot"]) {
  if (!templateSnapshot) {
    return [];
  }

  return Array.from(
    new Set([
      ...extractTemplateVariables(templateSnapshot.subject ?? ""),
      ...extractTemplateVariables(templateSnapshot.htmlBody ?? "")
    ])
  );
}

export function getUnresolvedTemplateVariables(
  variables: string[],
  payload: Record<string, unknown>
) {
  return variables.filter((variable) => {
    const value = payload[variable];
    return value === undefined || value === null || String(value).trim() === "";
  });
}

function getScheduleFailure(params: StructuredValidationParams, now: Date) {
  const scheduleConfig =
    params.scheduleConfig && typeof params.scheduleConfig === "object" && !Array.isArray(params.scheduleConfig)
      ? (params.scheduleConfig as Record<string, unknown>)
      : null;

  if (!params.scheduleType || params.scheduleType === "immediate") {
    return null;
  }

  if (params.scheduleType === "once") {
    const scheduledFor = scheduleConfig?.scheduledFor;
    if (typeof scheduledFor !== "string") {
      return "One-time schedule is missing a send time.";
    }

    const nextRunDate = getNextRunDate({
      type: "once",
      scheduledFor,
      ...(typeof scheduleConfig?.timeZone === "string" ? { timeZone: scheduleConfig.timeZone } : {})
    });
    if (Number.isNaN(nextRunDate.getTime()) || nextRunDate <= now) {
      return "One-time schedule must be in the future.";
    }

    return null;
  }

  if (params.scheduleType === "recurring") {
    const frequency = scheduleConfig?.frequency;
    const time = scheduleConfig?.time;
    const daysOfWeek = Array.isArray(scheduleConfig?.daysOfWeek) ? scheduleConfig.daysOfWeek : undefined;
    const dayOfWeek = typeof scheduleConfig?.dayOfWeek === "number" ? scheduleConfig.dayOfWeek : undefined;

    if ((frequency !== "daily" && frequency !== "weekly") || typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
      return "Recurring schedule is incomplete.";
    }

    if (frequency === "weekly" && !(daysOfWeek?.length || dayOfWeek !== undefined)) {
      return "Weekly schedule needs at least one day.";
    }

    const nextRunDate = getNextRunDate({
      type: "recurring",
      frequency,
      time,
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      ...(daysOfWeek ? { daysOfWeek: daysOfWeek.filter((day): day is number => typeof day === "number") } : {}),
      ...(typeof scheduleConfig?.timeZone === "string" ? { timeZone: scheduleConfig.timeZone } : {})
    });

    if (Number.isNaN(nextRunDate.getTime())) {
      return "Recurring schedule could not be evaluated.";
    }

    return null;
  }

  return "Schedule type is not recognized.";
}

async function buildAttachmentFailureChecks(attachments: CampaignAttachmentValidationRecord[]) {
  const checks: FailureCheckResult[] = [];

  for (const attachment of attachments) {
    if (!attachment.fileName || (!attachment.storagePath && !attachment.contentBase64)) {
      checks.push(
        createFailureCheck("ATTACHMENT_NOT_FOUND", "ATTACHMENT", {
          message: "Attachment metadata is incomplete.",
          details: attachment.fileName ? `${attachment.fileName} is missing stored content.` : "An attachment is missing a file name.",
          actionLabel: "Check attachments"
        })
      );
      continue;
    }

    if (attachment.contentBase64) {
      const size = Buffer.byteLength(attachment.contentBase64, "base64");
      if (size > MAX_ATTACHMENT_BYTES) {
        checks.push(
          createFailureCheck("ATTACHMENT_TOO_LARGE", "ATTACHMENT", {
            details: `${attachment.fileName} is larger than 10 MB.`,
            actionLabel: "Check attachments"
          })
        );
      }
      continue;
    }

    try {
      await access(attachment.storagePath as string, fsConstants.R_OK);
      const fileStats = await stat(attachment.storagePath as string);
      if (fileStats.size > MAX_ATTACHMENT_BYTES) {
        checks.push(
          createFailureCheck("ATTACHMENT_TOO_LARGE", "ATTACHMENT", {
            details: `${attachment.fileName} is larger than 10 MB.`,
            actionLabel: "Check attachments"
          })
        );
      }
    } catch {
      checks.push(
        createFailureCheck("ATTACHMENT_READ_FAILED", "ATTACHMENT", {
          details: `${attachment.fileName} could not be read from storage.`,
          actionLabel: "Check attachments"
        })
      );
    }
  }

  return checks;
}

export async function buildStructuredValidationChecks(params: StructuredValidationParams) {
  const checks: FailureCheckResult[] = [];
  const now = params.now ?? new Date();
  const sender = params.senderProfile;
  const importRecord = params.importRecord;
  const templateSnapshot = params.templateSnapshot;
  const mappingSnapshot = params.mappingSnapshot ?? {};
  const importColumnNames = new Set(importRecord?.columns.map((column) => column.normalized) ?? []);
  const mappedFieldNames = getMappedFieldNames(mappingSnapshot);
  const templateVariables = getTemplateVariables(templateSnapshot);

  if (!sender) {
    checks.push(
      createFailureCheck("GMAIL_PROFILE_DISCONNECTED", "GMAIL", {
        message: "Choose a Gmail sender before launch.",
        actionLabel: "Reconnect Gmail"
      })
    );
  } else {
    if (params.userId && sender.userId !== params.userId) {
      checks.push(
        createFailureCheck("GMAIL_PROFILE_DISCONNECTED", "GMAIL", {
          message: "The selected Gmail sender is not available to this account.",
          actionLabel: "Reconnect Gmail"
        })
      );
    }

    if (!sender.fromEmail?.trim()) {
      checks.push(
        createFailureCheck("GMAIL_PROFILE_DISCONNECTED", "GMAIL", {
          message: "The selected sender is missing an email address.",
          actionLabel: "Reconnect Gmail"
        })
      );
    }

    if (!sender.oauthRefreshToken) {
      checks.push(
        createFailureCheck("GMAIL_PROFILE_DISCONNECTED", "GMAIL", {
          actionLabel: "Reconnect Gmail"
        })
      );
    }
  }

  if (!importRecord) {
    checks.push(
      createFailureCheck("MISSING_IMPORT", "IMPORT", {
        actionLabel: "Review mapping"
      })
    );
  } else if ((importRecord.rowCount ?? importRecord.rows.length) <= 0 || importRecord.rows.length === 0) {
    checks.push(
      createFailureCheck("EMPTY_IMPORT", "IMPORT", {
        actionLabel: "Review mapping"
      })
    );
  }

  if (!params.mappingRecord) {
    checks.push(
      createFailureCheck("MISSING_MAPPING", "IMPORT", {
        actionLabel: "Review mapping"
      })
    );
  } else {
    if (params.userId && params.mappingRecord.userId !== params.userId) {
      checks.push(
        createFailureCheck("MISSING_MAPPING", "IMPORT", {
          message: "The selected mapping is not available to this account.",
          actionLabel: "Review mapping"
        })
      );
    }

    const emailField = mappingSnapshot.reservedFieldMap?.email;
    if (!emailField || !importColumnNames.has(emailField)) {
      checks.push(
        createFailureCheck("MISSING_MAPPING", "IMPORT", {
          message: "Recipient email mapping is missing.",
          actionLabel: "Review mapping"
        })
      );
    }

    const missingMappedFields = [...mappedFieldNames].filter((fieldName) => !importColumnNames.has(fieldName));
    if (missingMappedFields.length > 0) {
      checks.push(
        createFailureCheck("MISSING_MAPPING", "IMPORT", {
          message: "Mapped import fields no longer exist.",
          details: missingMappedFields.join(", "),
          actionLabel: "Review mapping"
        })
      );
    }
  }

  if (!params.templateRecord) {
    checks.push(
      createFailureCheck("MISSING_TEMPLATE", "TEMPLATE", {
        actionLabel: "Fix template variables"
      })
    );
  }

  if (!templateSnapshot?.subject?.trim()) {
    checks.push(
      createFailureCheck("EMPTY_TEMPLATE_SUBJECT", "TEMPLATE", {
        actionLabel: "Fix template variables"
      })
    );
  }

  if (!templateSnapshot?.htmlBody?.trim()) {
    checks.push(
      createFailureCheck("EMPTY_TEMPLATE_BODY", "TEMPLATE", {
        actionLabel: "Fix template variables"
      })
    );
  }

  const mappedTemplateVariables = new Set([
    ...Object.keys(mappingSnapshot.variableMap ?? {}),
    ...Object.keys(mappingSnapshot.reservedFieldMap ?? {})
  ]);
  const unmappedTemplateVariables = templateVariables.filter((variable) => !mappedTemplateVariables.has(variable));
  if (unmappedTemplateVariables.length > 0) {
    checks.push(
      createFailureCheck("MISSING_TEMPLATE_VARIABLE", "TEMPLATE", {
        details: unmappedTemplateVariables.join(", "),
        actionLabel: "Fix template variables"
      })
    );
  }

  const unresolvedVariables = new Set<string>();
  for (const row of importRecord?.rows ?? []) {
    const payload = buildMergePayload(row.normalized, mappingSnapshot);
    const renderedSubject = renderTemplate(templateSnapshot?.subject ?? "", payload);
    const renderedBody = renderTemplateContent(templateSnapshot?.format ?? "HTML", templateSnapshot?.htmlBody ?? "", payload);

    getUnresolvedTemplateVariables(templateVariables, payload).forEach((variable) => unresolvedVariables.add(variable));

    if (/{{\s*[a-zA-Z0-9_]+\s*}}/.test(renderedSubject) || /{{\s*[a-zA-Z0-9_]+\s*}}/.test(renderedBody)) {
      templateVariables.forEach((variable) => unresolvedVariables.add(variable));
    }
  }

  if (unresolvedVariables.size > 0 || params.report.issues.some((issue) => issue.code === "MISSING_VARIABLE")) {
    checks.push(
      createFailureCheck("UNRESOLVED_TEMPLATE_VARIABLE", "TEMPLATE", {
        message: "Some recipients have unresolved template variables and will be skipped.",
        details: Array.from(unresolvedVariables).join(", ") || undefined,
        actionLabel: "Fix template variables"
      })
    );
  }

  if (params.report.invalidRecipients > 0) {
    checks.push(
      createFailureCheck("INVALID_RECIPIENT_EMAIL", "VALIDATION", {
        details: `${params.report.invalidRecipients} invalid recipient${params.report.invalidRecipients === 1 ? "" : "s"}.`,
        actionLabel: "Review failed recipients"
      })
    );
  }

  if (params.report.duplicateRecipients > 0) {
    checks.push(
      createFailureCheck("DUPLICATE_RECIPIENT", "VALIDATION", {
        details: `${params.report.duplicateRecipients} duplicate recipient${params.report.duplicateRecipients === 1 ? "" : "s"}.`,
        actionLabel: "Review failed recipients"
      })
    );
  }

  if (params.report.suppressedRecipients > 0) {
    const unsubscribeCount = (importRecord?.rows ?? []).reduce((count, row) => {
      const payload = buildMergePayload(row.normalized, mappingSnapshot);
      const email =
        typeof payload.email === "string"
          ? payload.email.trim().toLowerCase()
          : row.email?.trim().toLowerCase() ?? null;
      return email && params.suppressionReasons?.get(email) === "UNSUBSCRIBED" ? count + 1 : count;
    }, 0);

    if (unsubscribeCount > 0) {
      checks.push(
        createFailureCheck("UNSUBSCRIBED_RECIPIENT", "SUPPRESSION", {
          details: `${unsubscribeCount} unsubscribed recipient${unsubscribeCount === 1 ? "" : "s"}.`,
          actionLabel: "Review failed recipients"
        })
      );
    }

    const suppressedOnlyCount = params.report.suppressedRecipients - unsubscribeCount;
    if (suppressedOnlyCount > 0) {
      checks.push(
        createFailureCheck("SUPPRESSED_RECIPIENT", "SUPPRESSION", {
          details: `${suppressedOnlyCount} suppressed recipient${suppressedOnlyCount === 1 ? "" : "s"}.`,
          actionLabel: "Review failed recipients"
        })
      );
    }
  }

  const scheduleFailure = getScheduleFailure(params, now);
  if (scheduleFailure) {
    checks.push(
      createFailureCheck("INVALID_SCHEDULE", "SCHEDULE", {
        details: scheduleFailure
      })
    );
  }

  checks.push(...(await buildAttachmentFailureChecks(templateSnapshot?.attachments ?? [])));

  if (params.systemHealth) {
    if (params.systemHealth.checks.database.status === "down") {
      checks.push(createFailureCheck("DATABASE_UNAVAILABLE", "DATABASE", { retryable: true }));
    }

    if (params.systemHealth.checks.redis.status === "down") {
      checks.push(createFailureCheck("REDIS_UNAVAILABLE", "QUEUE", { retryable: true }));
    }

    if (params.systemHealth.checks.appBaseUrl.status === "missing") {
      checks.push(createFailureCheck("APP_BASE_URL_MISSING", "SYSTEM"));
    }

    if (params.systemHealth.checks.sessionSecret.status === "missing") {
      checks.push(createFailureCheck("SESSION_SECRET_MISSING", "SYSTEM"));
    }

    if (process.env.NODE_ENV === "production" && params.systemHealth.checks.cron.status === "missing") {
      checks.push(createFailureCheck("CRON_NOT_CONFIGURED", "CRON"));
    }

    if ((sender?.provider === "google_oauth" || process.env.MAIL_PROVIDER === "gmail") && params.systemHealth.checks.googleOAuth.status === "missing") {
      checks.push(createFailureCheck("GOOGLE_OAUTH_NOT_CONFIGURED", "GMAIL"));
    }
  }

  return checks;
}

export function withStructuredValidationChecks(report: CampaignValidationReport, checks: FailureCheckResult[]) {
  return {
    ...report,
    checks,
    summary: summarizeFailureChecks(checks)
  };
}

export function getLaunchBlockingValidationChecks(report: CampaignValidationReport) {
  return (report.checks ?? []).filter((check) => check.severity === "BLOCKER" || check.severity === "ERROR");
}

export function getLaunchBlockingValidationMessage(report: CampaignValidationReport) {
  const [primaryCheck] = getLaunchBlockingValidationChecks(report);

  if (!primaryCheck) {
    return "Fix validation blockers before launching this sequence.";
  }

  return primaryCheck.details ? `${primaryCheck.message} ${primaryCheck.details}` : primaryCheck.message;
}
