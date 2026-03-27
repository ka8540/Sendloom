"use client";

import { useMemo } from "react";

type LocalDateTimeProps = {
  value?: string | null;
  emptyLabel?: string;
  className?: string;
};

export function LocalDateTime({ value, emptyLabel = "Not available", className }: LocalDateTimeProps) {
  const formatted = useMemo(() => {
    if (!value) {
      return emptyLabel;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return emptyLabel;
    }

    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: browserTimeZone,
      timeZoneName: "short"
    }).format(date);
  }, [emptyLabel, value]);

  return <span className={className}>{formatted}</span>;
}
