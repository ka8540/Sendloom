export type AudienceOption = {
  id: string;
  label: string;
  rowCount: number;
  mappedFields: string[];
};

export type TemplateOption = {
  id: string;
  label: string;
  formatLabel: string;
  subject: string;
  snippet: string;
};

export const WIZARD_STEPS = ["Audience", "Message", "Timing", "Review"] as const;

export const DEFAULT_AUDIENCE_LIMIT = 5;
export const DEFAULT_TEMPLATE_LIMIT = 5;

export type WizardStep = 0 | 1 | 2 | 3;

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterAudienceOptions(options: AudienceOption[], query: string) {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return options.slice(0, DEFAULT_AUDIENCE_LIMIT);
  }

  return options.filter((option) =>
    [option.label, ...option.mappedFields].some((value) => normalizeSearch(value).includes(normalizedQuery))
  );
}

export function filterTemplateOptions(options: TemplateOption[], query: string) {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return options.slice(0, DEFAULT_TEMPLATE_LIMIT);
  }

  return options.filter((option) =>
    [option.label, option.formatLabel, option.subject, option.snippet].some((value) =>
      normalizeSearch(value).includes(normalizedQuery)
    )
  );
}

export function isAudienceStepComplete(name: string, importId: string, mappingId: string) {
  return Boolean(name.trim() && importId && mappingId);
}

export function isTimingStepComplete(args: {
  scheduleType: string;
  scheduledFor: string;
  sendTime: string;
  frequency: string;
  selectedWeekdays: number[];
}) {
  if (args.scheduleType === "once") {
    return Boolean(args.scheduledFor);
  }

  if (args.scheduleType === "recurring") {
    return Boolean(args.sendTime && (args.frequency !== "weekly" || args.selectedWeekdays.length));
  }

  return true;
}
