"use client";

import { useEffect, useMemo, useState } from "react";

type LocalDateTimeProps = {
  value?: string | null;
  emptyLabel?: string;
  className?: string;
  variant?: "dateTime" | "time";
};

const HYDRATION_TIME_ZONE = "UTC";

export function formatDateTimeForTimeZone(
  value: string | null | undefined,
  emptyLabel: string,
  variant: "dateTime" | "time",
  timeZone: string
) {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return emptyLabel;
  }

  const options: Intl.DateTimeFormatOptions =
    variant === "time"
      ? {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
          timeZoneName: "short"
        }
      : {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone,
          timeZoneName: "short"
        };

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function readBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || HYDRATION_TIME_ZONE;
  } catch {
    return HYDRATION_TIME_ZONE;
  }
}

export function LocalDateTime({ value, emptyLabel = "Not available", className, variant = "dateTime" }: LocalDateTimeProps) {
  const [browserTimeZone, setBrowserTimeZone] = useState<string | null>(null);

  useEffect(() => {
    setBrowserTimeZone(readBrowserTimeZone());
  }, []);

  const formatted = useMemo(() => {
    return formatDateTimeForTimeZone(value, emptyLabel, variant, browserTimeZone ?? HYDRATION_TIME_ZONE);
  }, [browserTimeZone, emptyLabel, value, variant]);

  return <span className={className}>{formatted}</span>;
}
