"use client";

import { usePathname } from "next/navigation";

import { LoadScreen } from "@/components/load-screen";

const LOAD_SCREEN_PATHS = new Set(["/", "/login", "/signup"]);

export function PublicLoadScreen() {
  const pathname = usePathname();

  if (!pathname || !LOAD_SCREEN_PATHS.has(pathname)) {
    return null;
  }

  return <LoadScreen />;
}
