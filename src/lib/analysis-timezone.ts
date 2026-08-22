export const ANALYSIS_TIME_ZONE_FALLBACK = "UTC";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6]
]);
const normalizedTimeZones = new Map<string, string>();
const zonedPartFormatters = new Map<string, Intl.DateTimeFormat>();

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type ZonedDateParts = CalendarDateParts & {
  weekdayIndex: number;
  hour: number;
  minute: number;
  second: number;
};

function formatterPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`Missing ${type} from Analysis date formatter.`);
  return value;
}

export function normalizeAnalysisTimeZone(value: unknown) {
  if (typeof value !== "string") return ANALYSIS_TIME_ZONE_FALLBACK;
  const candidate = value.trim();
  if (!candidate || candidate.length > 100 || /^[+-]\d/.test(candidate)) return ANALYSIS_TIME_ZONE_FALLBACK;
  const cached = normalizedTimeZones.get(candidate);
  if (cached) return cached;

  try {
    const normalized = new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
    normalizedTimeZones.set(candidate, normalized);
    return normalized;
  } catch (error) {
    if (error instanceof RangeError) return ANALYSIS_TIME_ZONE_FALLBACK;
    return ANALYSIS_TIME_ZONE_FALLBACK;
  }
}

export function detectBrowserAnalysisTimeZone() {
  try {
    return normalizeAnalysisTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return ANALYSIS_TIME_ZONE_FALLBACK;
  }
}

export function parseAnalysisDateKey(value: string | null | undefined): CalendarDateParts | null {
  const match = value?.match(DATE_KEY_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dateKeyFromParts({ year, month, day }: CalendarDateParts) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addAnalysisCalendarDays(dateKey: string, amount: number) {
  const parts = parseAnalysisDateKey(dateKey);
  if (!parts) throw new RangeError(`Invalid Analysis date key: ${dateKey}`);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return date.toISOString().slice(0, 10);
}

export function analysisCalendarDayDifference(from: string, to: string) {
  const start = parseAnalysisDateKey(from);
  const end = parseAnalysisDateKey(to);
  if (!start || !end) return null;
  const startOrdinal = Date.UTC(start.year, start.month - 1, start.day);
  const endOrdinal = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endOrdinal - startOrdinal) / CALENDAR_DAY_MS);
}

function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  let formatter = zonedPartFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    zonedPartFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const weekday = formatterPart(parts, "weekday");
  const weekdayIndex = WEEKDAY_INDEX.get(weekday);
  if (weekdayIndex === undefined) throw new Error(`Unknown Analysis weekday: ${weekday}`);
  return {
    year: Number(formatterPart(parts, "year")),
    month: Number(formatterPart(parts, "month")),
    day: Number(formatterPart(parts, "day")),
    weekdayIndex,
    hour: Number(formatterPart(parts, "hour")),
    minute: Number(formatterPart(parts, "minute")),
    second: Number(formatterPart(parts, "second"))
  };
}

export function instantToAnalysisDateKey(date: Date, timeZone: string) {
  return dateKeyFromParts(zonedDateParts(date, normalizeAnalysisTimeZone(timeZone)));
}

export function analysisLocalWeekdayHour(date: Date, timeZone: string) {
  const parts = zonedDateParts(date, normalizeAnalysisTimeZone(timeZone));
  return { weekdayIndex: parts.weekdayIndex, hour: parts.hour };
}

export function analysisHeatmapBucket(date: Date, timeZone: string) {
  const { weekdayIndex, hour } = analysisLocalWeekdayHour(date, timeZone);
  return { weekdayIndex, blockIndex: Math.min(5, Math.floor(hour / 4)) };
}

/** Convert a local calendar midnight to its UTC instant using the IANA zone's rules. */
export function analysisLocalDateStartUtc(dateKey: string, timeZone: string) {
  const target = parseAnalysisDateKey(dateKey);
  if (!target) throw new RangeError(`Invalid Analysis date key: ${dateKey}`);
  const zone = normalizeAnalysisTimeZone(timeZone);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  let candidate = targetAsUtc;

  // Re-evaluate the zone at the corrected instant. This is what makes a range
  // boundary follow DST changes instead of assuming one fixed numeric offset.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = zonedDateParts(new Date(candidate), zone);
    const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const delta = representedAsUtc - targetAsUtc;
    if (delta === 0) return new Date(candidate);
    candidate -= delta;
  }

  const result = new Date(candidate);
  const local = zonedDateParts(result, zone);
  if (dateKeyFromParts(local) !== dateKey || local.hour !== 0 || local.minute !== 0 || local.second !== 0) {
    throw new RangeError(`Could not resolve local Analysis date boundary for ${dateKey} in ${zone}.`);
  }
  return result;
}

export function enumerateAnalysisDateKeys(from: string, endExclusive: string) {
  const keys: string[] = [];
  for (let cursor = from; cursor < endExclusive; cursor = addAnalysisCalendarDays(cursor, 1)) {
    keys.push(cursor);
  }
  return keys;
}

export function formatAnalysisDateKey(
  dateKey: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: normalizeAnalysisTimeZone(timeZone)
  }).format(analysisLocalDateStartUtc(dateKey, timeZone));
}

export function formatAnalysisInstant(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: normalizeAnalysisTimeZone(timeZone)
  }).format(date);
}
