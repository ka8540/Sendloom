"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import type { ManualConfig } from "@/components/manual/manualTypes";
import { ManualButton } from "@/components/manual/ManualButton";
import { ManualOverlay } from "@/components/manual/ManualOverlay";
import { getManualForPathname } from "@/manuals";

type ManualContextValue = {
  currentStepIndex: number;
  isOpen: boolean;
  manual: ManualConfig | null;
  finishManual: () => void;
  nextStep: () => void;
  openManual: () => void;
  skipManual: () => void;
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

function getStorageKey(manualId: string) {
  return `${STORAGE_PREFIX}${manualId}`;
}

function isManualComplete(manualId: string) {
  try {
    return window.localStorage.getItem(getStorageKey(manualId)) === "true";
  } catch {
    return false;
  }
}

function markManualComplete(manualId: string) {
  try {
    window.localStorage.setItem(getStorageKey(manualId), "true");
  } catch {
    // If storage is unavailable, keep the current session state only.
  }
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
  return (
    <>
      {children}
      <ManualRuntime />
    </>
  );
}

function ManualRuntime() {
  const pathname = usePathname();
  const manual = useMemo(() => getManualForPathname(pathname), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    setIsOpen(false);
    setCurrentStepIndex(0);

    if (!manual) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!isManualComplete(manual.id)) {
        setIsOpen(true);
      }
    }, AUTO_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [manual]);

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

  const finishManual = useCallback(() => {
    if (manual) {
      markManualComplete(manual.id);
    }

    setIsOpen(false);
    setCurrentStepIndex(0);
  }, [manual]);

  const nextStep = useCallback(() => {
    if (!manual) {
      return;
    }

    setCurrentStepIndex((stepIndex) => {
      const nextIndex = stepIndex + 1;

      if (nextIndex >= manual.steps.length) {
        markManualComplete(manual.id);
        setIsOpen(false);
        return 0;
      }

      return nextIndex;
    });
  }, [manual]);

  const openManual = useCallback(() => {
    if (!manual) {
      return;
    }

    setCurrentStepIndex(0);
    setIsOpen(true);
  }, [manual]);

  const skipManual = useCallback(() => {
    if (manual) {
      markManualComplete(manual.id);
    }

    setIsOpen(false);
    setCurrentStepIndex(0);
  }, [manual]);

  const value = useMemo<ManualContextValue>(
    () => ({
      currentStepIndex,
      finishManual,
      isOpen,
      manual,
      nextStep,
      openManual,
      skipManual
    }),
    [currentStepIndex, finishManual, isOpen, manual, nextStep, openManual, skipManual]
  );

  return (
    <ManualContext.Provider value={value}>
      <ManualButton />
      <ManualOverlay />
    </ManualContext.Provider>
  );
}
