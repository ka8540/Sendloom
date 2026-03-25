"use client";

import dynamic from "next/dynamic";

export const LandingSceneShell = dynamic(
  () => import("@/components/landing-scene").then((module) => module.LandingScene),
  {
    ssr: false
  }
);
