import { addDays, addWeeks, set } from "date-fns";

import type { ScheduleRule } from "@/lib/types";

export function getNextRunDate(rule: ScheduleRule) {
  if (rule.type === "immediate") {
    return new Date();
  }

  if (rule.type === "once") {
    return new Date(rule.scheduledFor);
  }

  const [hours, minutes] = rule.time.split(":").map(Number);
  const today = set(new Date(), { hours, minutes, seconds: 0, milliseconds: 0 });

  if (rule.frequency === "daily") {
    return today > new Date() ? today : addDays(today, 1);
  }

  let candidate = today;
  while (candidate.getDay() !== (rule.dayOfWeek ?? 1)) {
    candidate = addDays(candidate, 1);
  }

  if (candidate <= new Date()) {
    candidate = addWeeks(candidate, 1);
  }

  return candidate;
}
