"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ActiveRunRefresher({
  active,
  intervalMs = 8_000
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [active, intervalMs, router]);

  return null;
}
