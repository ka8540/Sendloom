"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";
import { ManualButton } from "@/components/manual/ManualButton";
import { ManualOverlay } from "@/components/manual/ManualOverlay";
import { filterAvailableManualSteps, isManualTargetPresent } from "@/components/manual/manualSteps";
import { getManualForPathname } from "@/manuals";

type ManualContextValue = {
  currentStepIndex: number;
  isOpen: boolean;
  manual: ManualConfig | null;
  /** The steps currently driving the overlay (stage-resolved + availability-filtered). */
  steps: ManualStep[];
  activeStage: string | null;
  finishManual: () => void;
  nextStep: () => void;
  previousStep: () => void;
  openManual: () => void;
  openManualStage: (stage: string | null) => void;
  skipManual: () => void;
  isStageComplete: (stage: string | null) => boolean;
};

const ManualContext = createContext<ManualContextValue | null>(null);
const STORAGE_PREFIX = "sendloom.manual.completed.";
const AUTO_OPEN_DELAY_MS = 650;
const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " "
]);

function getStorageKey(manual: ManualConfig, stage: string | null) {
  const stageSuffix = stage ? `.${stage}` : "";
  const versionSuffix = manual.version ? `.${manual.version}` : "";
  return `${STORAGE_PREFIX}${manual.id}${stageSuffix}${versionSuffix}`;
}

function isManualComplete(manual: ManualConfig, stage: string | null) {
  try {
    return window.localStorage.getItem(getStorageKey(manual, stage)) === "true";
  } catch {
    return false;
  }
}

function markManualComplete(manual: ManualConfig, stage: string | null) {
  try {
    window.localStorage.setItem(getStorageKey(manual, stage), "true");
  } catch {
    // If storage is unavailable, keep the current session state only.
  }
}

function resolveStepsForStage(manual: ManualConfig, stage: string | null): ManualStep[] {
  const base = manual.resolveSteps ? manual.resolveSteps(stage) : manual.steps;
  return filterAvailableManualSteps(base, isManualTargetPresent);
}

function isManualActivationKey(event: KeyboardEvent) {
  if (event.key !== " " && event.key !== "Enter") {
    return false;
  }

  return event.target instanceof Element && Boolean(event.target.closest("[data-manual-control='true']"));
}

function canScrollInsideManual(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  const popover = target.closest("[data-manual-popover='true']");

  return popover instanceof HTMLElement && popover.scrollHeight > popover.clientHeight;
}

export function useManual() {
  const value = useContext(ManualContext);

  if (!value) {
    throw new Error("useManual must be used inside ManualProvider");
  }

  return value;
}

export function ManualProvider({ children }: { children: React.ReactNode }) {
  return <ManualRuntime>{children}</ManualRuntime>;
}

function ManualRuntime({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const manual = useMemo(() => getManualForPathname(pathname), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [steps, setSteps] = useState<ManualStep[]>([]);
  const wasOpenRef = useRef(false);

  const open = useCallback(
    (stage: string | null) => {
      if (!manual) {
        return;
      }
      const resolvedSteps = resolveStepsForStage(manual, stage);
      if (resolvedSteps.length === 0) {
        return;
      }
      setActiveStage(stage);
      setSteps(resolvedSteps);
      setCurrentStepIndex(0);
      setIsOpen(true);
    },
    [manual]
  );

  // Reset on route/manual change, then auto-open once (unless the manual opts out).
  useEffect(() => {
    setIsOpen(false);
    setCurrentStepIndex(0);
    setActiveStage(null);
    setSteps([]);

    if (!manual || manual.autoOpen === false) {
      return;
    }

    const timer = window.setTimeout(() => {
      const stage = manual.resolveStage ? manual.resolveStage() : null;
      if (!isManualComplete(manual, stage)) {
        open(stage);
      }
    }, AUTO_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [manual, open]);

  // Scroll lock while a tour is open (unchanged from the original behavior).
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    const preventWheel = (event: WheelEvent) => {
      if (!canScrollInsideManual(event.target)) {
        event.preventDefault();
      }
    };

    const preventTouchMove = (event: TouchEvent) => {
      if (!canScrollInsideManual(event.target)) {
        event.preventDefault();
      }
    };

    const preventKeyboardScroll = (event: KeyboardEvent) => {
      if (
        SCROLL_KEYS.has(event.key) &&
        !isManualActivationKey(event) &&
        !canScrollInsideManual(event.target)
      ) {
        event.preventDefault();
      }
    };

    document.addEventListener("wheel", preventWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", preventTouchMove, { capture: true, passive: false });
    document.addEventListener("keydown", preventKeyboardScroll, { capture: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      document.removeEventListener("wheel", preventWheel, true);
      document.removeEventListener("touchmove", preventTouchMove, true);
      document.removeEventListener("keydown", preventKeyboardScroll, true);
    };
  }, [isOpen]);

  // Return focus to the help button after the tour closes (accessibility).
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      const button = document.querySelector<HTMLElement>("[data-manual-help-button='true']");
      if (button) {
        window.requestAnimationFrame(() => button.focus());
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const finishManual = useCallback(() => {
    if (manual) {
      markManualComplete(manual, activeStage);
    }

    setIsOpen(false);
    setCurrentStepIndex(0);
  }, [activeStage, manual]);

  const nextStep = useCallback(() => {
    setCurrentStepIndex((stepIndex) => {
      const nextIndex = stepIndex + 1;

      if (nextIndex >= steps.length) {
        if (manual) {
          markManualComplete(manual, activeStage);
        }
        setIsOpen(false);
        return 0;
      }

      return nextIndex;
    });
  }, [activeStage, manual, steps.length]);

  const previousStep = useCallback(() => {
    setCurrentStepIndex((stepIndex) => Math.max(0, stepIndex - 1));
  }, []);

  const openManual = useCallback(() => {
    if (!manual) {
      return;
    }
    open(manual.resolveStage ? manual.resolveStage() : null);
  }, [manual, open]);

  const openManualStage = useCallback(
    (stage: string | null) => {
      open(stage);
    },
    [open]
  );

  const skipManual = useCallback(() => {
    if (manual) {
      markManualComplete(manual, activeStage);
    }

    setIsOpen(false);
    setCurrentStepIndex(0);
  }, [activeStage, manual]);

  const isStageComplete = useCallback(
    (stage: string | null) => (manual ? isManualComplete(manual, stage) : false),
    [manual]
  );

  const value = useMemo<ManualContextValue>(
    () => ({
      activeStage,
      currentStepIndex,
      finishManual,
      isOpen,
      isStageComplete,
      manual,
      nextStep,
      previousStep,
      openManual,
      openManualStage,
      skipManual,
      steps
    }),
    [
      activeStage,
      currentStepIndex,
      finishManual,
      isOpen,
      isStageComplete,
      manual,
      nextStep,
      previousStep,
      openManual,
      openManualStage,
      skipManual,
      steps
    ]
  );

  return (
    <ManualContext.Provider value={value}>
      {children}
      <ManualButton />
      <ManualOverlay />
    </ManualContext.Provider>
  );
}
