"use client";

import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { canUseBrowserBack, getDefaultBackFallback, type AppFallbackHref } from "@/lib/back-navigation";

type BackButtonProps = {
  alwaysUseFallback?: boolean;
  className?: string;
  fallbackHref?: AppFallbackHref;
  label?: string;
};

export function BackButton({ alwaysUseFallback = false, className, fallbackHref, label = "Go back" }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleClick = useCallback(() => {
    if (
      !alwaysUseFallback &&
      typeof window !== "undefined" &&
      canUseBrowserBack({
        currentOrigin: window.location.origin,
        currentPathname: pathname,
        historyLength: window.history.length,
        referrer: document.referrer
      })
    ) {
      router.back();
      return;
    }

    router.push(fallbackHref ?? getDefaultBackFallback(pathname));
  }, [alwaysUseFallback, fallbackHref, pathname, router]);

  return (
    <button
      aria-label={label}
      className={`back-button${className ? ` ${className}` : ""}`}
      title={label}
      type="button"
      onClick={handleClick}
    >
      <ArrowLeft aria-hidden="true" />
    </button>
  );
}
