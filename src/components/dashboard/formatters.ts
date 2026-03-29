import type { DashboardTrend } from "@/components/dashboard/types";

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "Just now";
  }

  const date = value instanceof Date ? value : new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) {
    return relativeFormatter.format(Math.round(diffSeconds), "second");
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return relativeFormatter.format(diffDays, "day");
  }

  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return relativeFormatter.format(diffWeeks, "week");
  }

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return relativeFormatter.format(diffMonths, "month");
  }

  const diffYears = Math.round(diffDays / 365);
  return relativeFormatter.format(diffYears, "year");
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) {
    return "No activity yet";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function humanizeEnum(value?: string | null) {
  if (!value) {
    return "Not set";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

export function buildTrend(current: number, previous: number, noun: string): DashboardTrend {
  const delta = current - previous;

  if (delta === 0) {
    return {
      direction: "flat",
      label: `Flat vs last ${noun}`
    };
  }

  if (previous === 0) {
    return {
      direction: delta > 0 ? "up" : "down",
      label: `${delta > 0 ? "+" : ""}${delta} vs last ${noun}`
    };
  }

  const percentage = Math.round((Math.abs(delta) / previous) * 100);
  return {
    direction: delta > 0 ? "up" : "down",
    label: `${delta > 0 ? "+" : "-"}${percentage}% vs last ${noun}`
  };
}
