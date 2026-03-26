"use client";

import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

type BackButtonProps = {
  className?: string;
  fallbackHref?: AppFallbackHref;
  label?: string;
};

type AppFallbackHref = "/" | "/campaigns" | "/imports" | "/suppressions" | "/templates" | "/workspace";

function getDefaultFallback(pathname: string): AppFallbackHref {
  if (pathname.startsWith("/campaigns")) {
    return "/campaigns";
  }

  if (pathname.startsWith("/imports")) {
    return "/imports";
  }

  if (pathname.startsWith("/templates")) {
    return "/templates";
  }

  if (pathname.startsWith("/suppressions")) {
    return "/suppressions";
  }

  if (pathname.startsWith("/workspace")) {
    return "/";
  }

  return "/";
}

function canGoBack(pathname: string) {
  if (typeof window === "undefined" || window.history.length <= 1 || !document.referrer) {
    return false;
  }

  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin && referrer.pathname !== pathname;
  } catch {
    return false;
  }
}

export function BackButton({ className, fallbackHref, label = "Go back" }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleClick = useCallback(() => {
    if (canGoBack(pathname)) {
      router.back();
      return;
    }

    router.push(fallbackHref ?? getDefaultFallback(pathname));
  }, [fallbackHref, pathname, router]);

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
