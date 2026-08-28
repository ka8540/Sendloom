import { convertScheduledLocalInputToUtc } from "@/lib/schedule";

export type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

export type LocalDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
};

export type TwelveHourTime = {
  hour: number;
  minute: number;
  period: "AM" | "PM";
};

const LOCAL_DATE_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function parseLocalDateTimeValue(value: string): LocalDateTimeParts | null {
  const match = value.match(LOCAL_DATE_TIME_PATTERN);
  if (!match?.groups) return null;

  const parts: LocalDateTimeParts = {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute)
  };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return parts;
}

export function composeLocalDateTimeValue(parts: LocalDateTimeParts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function getZonedDateTimeParts(date: Date, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export function getCalendarGrid(year: number, month: number) {
  const weekdayOffset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((weekdayOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - weekdayOffset + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
}

export function compareCalendarDates(left: CalendarDateParts, right: CalendarDateParts) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export function toTwelveHourTime(hour: number, minute: number): TwelveHourTime {
  return {
    hour: hour % 12 || 12,
    minute,
    period: hour >= 12 ? "PM" : "AM"
  };
}

export function toTwentyFourHour(hour: number, period: "AM" | "PM") {
  if (hour < 1 || hour > 12 || !Number.isInteger(hour)) return null;
  if (period === "AM") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

export function clampTimeField(value: string, min: number, max: number, fallback: number) {
  if (!/^\d+$/.test(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export function isFutureLocalDateTimeValue(value: string, timeZone: string, now = new Date()) {
  if (!parseLocalDateTimeValue(value)) return false;

  try {
    const scheduledDate = convertScheduledLocalInputToUtc(value, timeZone);
    return !Number.isNaN(scheduledDate.getTime()) && scheduledDate > now;
  } catch {
    return false;
  }
}

export function formatSequenceDateTime(value: string) {
  const parts = parseLocalDateTimeValue(value);
  if (!parts) return "Choose a future date and time";

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);

  return `${dateLabel} · ${timeLabel}`;
}
