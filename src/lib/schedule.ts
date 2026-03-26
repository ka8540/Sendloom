import { addDays } from "date-fns";

import type { ScheduleRule } from "@/lib/types";

export const fallbackTimeZones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland"
] as const;

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: weekdayMap[values.weekday] ?? 0
  };
}

function localDateTimeToUtc(args: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) {
  let guess = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const zoned = getZonedParts(new Date(guess), timeZone);
    const actual = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second, 0);
    const target = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, 0, 0);

    if (actual === target) {
      break;
    }

    guess += target - actual;
  }

  return new Date(guess);
}

function addCalendarDays(parts: Pick<ZonedDateParts, "year" | "month" | "day">, count: number) {
  const date = addDays(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0)), count);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function hasExplicitOffset(value: string) {
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value);
}

function parseLocalDateTime(value: string) {
  const match = value.match(
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/
  );

  if (!match?.groups) {
    return null;
  }

  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute)
  };
}

export function convertScheduledLocalInputToUtc(value: string, timeZone: string) {
  if (hasExplicitOffset(value)) {
    return new Date(value);
  }

  const localDateTime = parseLocalDateTime(value);
  if (!localDateTime) {
    return new Date(value);
  }

  return localDateTimeToUtc(localDateTime, timeZone);
}

function getOnceRunDate(rule: Extract<ScheduleRule, { type: "once" }>) {
  return convertScheduledLocalInputToUtc(rule.scheduledFor, rule.timeZone ?? "UTC");
}

export function getNextRunDate(rule: ScheduleRule, now = new Date()) {
  if (rule.type === "immediate") {
    return now;
  }

  if (rule.type === "once") {
    return getOnceRunDate(rule);
  }

  const timeZone = rule.timeZone ?? "UTC";
  const [hours, minutes] = rule.time.split(":").map(Number);
  const zonedNow = getZonedParts(now, timeZone);

  const initialDate =
    rule.frequency === "daily"
      ? { year: zonedNow.year, month: zonedNow.month, day: zonedNow.day }
      : addCalendarDays(
          { year: zonedNow.year, month: zonedNow.month, day: zonedNow.day },
          (rule.dayOfWeek ?? 1) - zonedNow.weekday >= 0
            ? (rule.dayOfWeek ?? 1) - zonedNow.weekday
            : 7 - zonedNow.weekday + (rule.dayOfWeek ?? 1)
        );

  let candidate = localDateTimeToUtc(
    {
      ...initialDate,
      hour: hours,
      minute: minutes
    },
    timeZone
  );

  if (candidate <= now) {
    const nextDate = addCalendarDays(initialDate, rule.frequency === "daily" ? 1 : 7);
    candidate = localDateTimeToUtc(
      {
        ...nextDate,
        hour: hours,
        minute: minutes
      },
      timeZone
    );
  }

  return candidate;
}
