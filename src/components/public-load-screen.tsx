"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { StartupSplash } from "@/components/startup-splash";
import { isLoadScreenPath } from "@/lib/load-screen";

// Runs before paint on the client (so a "hide" decision unmounts the splash
// before its effects fire), and is a warning-free no-op during SSR.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Gate for the startup splash. It decides ONCE, on the first mount, whether to
// render the splash — so it appears on a true full-page load of a splash path
// but never replays during client-side navigation, on a component remount, or on
// a theme/query change (the root layout, and therefore this component, persists
// across soft navigations).
export function PublicLoadScreen() {
  const pathname = usePathname();

  // Initial state is derived purely from the pathname so the server and the first
  // client render agree (no hydration mismatch) and the overlay is part of the
  // initial HTML on splash paths — covering the page from the first paint.
  const [showSplash, setShowSplash] = useState(() => isLoadScreenPath(pathname));
  const reconciledRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    // Reconcile exactly once with the synchronous boot script's decision, then
    // never re-evaluate — subsequent client navigations must not re-show it.
    if (reconciledRef.current) {
      return;
    }
    reconciledRef.current = true;
    setShowSplash(document.documentElement.dataset.loadScreen === "show");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!showSplash) {
    return null;
  }

  return <StartupSplash />;
}
