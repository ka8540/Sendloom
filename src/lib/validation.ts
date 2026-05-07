import type { CampaignValidationReport, ValidationIssue } from "@/lib/types";
import { extractTemplateVariables } from "@/lib/templates";
import { isValidEmail } from "@/lib/utils";

type ValidationParams = {
  rows: Array<{ rowIndex: number; email: string | null; payload: Record<string, unknown> }>;
  templateSubject: string;
  templateHtml: string;
  additionalTemplates?: Array<{ subject: string; html: string }>;
  suppressedEmails: Set<string>;
};

export function buildValidationReport(params: ValidationParams): CampaignValidationReport {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const requiredVariables = new Set([
    ...extractTemplateVariables(params.templateSubject),
    ...extractTemplateVariables(params.templateHtml),
    ...(params.additionalTemplates ?? []).flatMap((template) => [
      ...extractTemplateVariables(template.subject),
      ...extractTemplateVariables(template.html)
    ])
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
