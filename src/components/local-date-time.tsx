"use client";

import { useMemo } from "react";

type LocalDateTimeProps = {
  value?: string | null;
  emptyLabel?: string;
  className?: string;
  variant?: "dateTime" | "time";
};

export function LocalDateTime({ value, emptyLabel = "Not available", className, variant = "dateTime" }: LocalDateTimeProps) {
  const formatted = useMemo(() => {
    if (!value) {
      return emptyLabel;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return emptyLabel;
    }

    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const options: Intl.DateTimeFormatOptions =
      variant === "time"
        ? {
            hour: "numeric",
            minute: "2-digit",
            timeZone: browserTimeZone,
            timeZoneName: "short"
          }
        : {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: browserTimeZone,
            timeZoneName: "short"
          };

    return new Intl.DateTimeFormat("en-US", options).format(date);
  }, [emptyLabel, value, variant]);

  return <span className={className}>{formatted}</span>;
}
