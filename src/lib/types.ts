export type ReservedField = "email" | "name" | "company" | "firstName" | "lastName";

export type ReservedFieldMap = Partial<Record<ReservedField, string>>;

export type VariableMap = Record<string, string>;

export type MergeVariables = Record<string, string | number | boolean | null>;

export type ValidationIssue = {
  code:
    | "INVALID_EMAIL"
    | "MISSING_EMAIL"
    | "DUPLICATE_EMAIL"
    | "MISSING_VARIABLE"
    | "SUPPRESSED"
    | "SENDER_NOT_READY"
    | "TEMPLATE_INVALID";
  message: string;
  rowIndex?: number;
  email?: string;
};

export type CampaignValidationReport = {
  validRecipients: number;
  invalidRecipients: number;
  suppressedRecipients: number;
  duplicateRecipients: number;
  estimatedDurationMinutes: number;
  issues: ValidationIssue[];
};

export type ScheduleRule =
  | {
      type: "immediate";
    }
  | {
      type: "once";
      scheduledFor: string;
      timeZone?: string;
    }
  | {
      type: "recurring";
      frequency: "daily" | "weekly";
      time: string;
      dayOfWeek?: number;
      timeZone?: string;
    };

export type QueueJobName = "validate-campaign" | "launch-run" | "send-recipient" | "process-webhook";
