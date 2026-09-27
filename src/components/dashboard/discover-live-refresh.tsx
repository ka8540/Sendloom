"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useDiscoverLivePolling } from "@/components/prospects/use-discover-live-polling";

export function DiscoverLiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useDiscoverLivePolling({ active, refresh });
  return null;
}
