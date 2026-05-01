"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";

import type { ManualPlacement } from "@/components/manual/manualTypes";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

type HighlightRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type ViewportSize = {
  height: number;
  width: number;
};

type PopoverSize = {
  height: number;
  width: number;
};

type OverlayGeometry = {
  popoverSize: PopoverSize;
  targetRect: HighlightRect | null;
  viewport: ViewportSize;
};

const SPOTLIGHT_PADDING = 8;
const VIEWPORT_GUTTER = 18;
const TARGET_GAP = 16;
const TARGET_REFRESH_DELAY_MS = 90;
const SCROLL_MIN_SETTLE_MS = 160;
const SCROLL_SETTLE_TIMEOUT_MS = 950;
const SCROLL_STABLE_FRAME_COUNT = 4;
const DEFAULT_POPOVER_SIZE: PopoverSize = {
  height: 244,
  width: 348
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTargetElement(selector?: string): HTMLElement | null {
  if (!selector) {
    return null;
  }

  const target = document.querySelector(selector);

  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target;
}

function getElementRect(selector?: string): HighlightRect | null {
  const target = getTargetElement(selector);

  if (!target) {
    return null;
  }

  const rect = target.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width
  };
}

function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeRect(rect: HighlightRect | null): HighlightRect | null {
  if (!rect) {
    return null;
  }

  return {
    bottom: roundNumber(rect.bottom),
    height: roundNumber(rect.height),
    left: roundNumber(rect.left),
    right: roundNumber(rect.right),
    top: roundNumber(rect.top),
    width: roundNumber(rect.width)
  };
}

function scrollTargetIntoView(selector?: string) {
  const target = getTargetElement(selector);

  if (!target) {
    return false;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest"
  });

  return true;
}

function areRectsEqual(left: HighlightRect | null, right: HighlightRect | null) {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.bottom === right.bottom &&
    left.height === right.height &&
    left.left === right.left &&
    left.right === right.right &&
    left.top === right.top &&
    left.width === right.width
  );
}

function areGeometriesEqual(left: OverlayGeometry, right: OverlayGeometry) {
  return (
    areRectsEqual(left.targetRect, right.targetRect) &&
    left.viewport.height === right.viewport.height &&
    left.viewport.width === right.viewport.width &&
    left.popoverSize.height === right.popoverSize.height &&
    left.popoverSize.width === right.popoverSize.width
  );
}

function getPlacementOrder(placement: ManualPlacement | undefined) {
  const preferred = placement ?? "bottom";

  if (preferred === "center") {
    return ["center"] as const;
  }

  const fallbacks = {
    bottom: ["bottom", "top", "right", "left"],
    top: ["top", "bottom", "right", "left"],
    right: ["right", "left", "bottom", "top"],
    left: ["left", "right", "bottom", "top"]
  } as const;

  return fallbacks[preferred];
}

function hasRoom(rect: HighlightRect, placement: Exclude<ManualPlacement, "center">, viewport: ViewportSize, popoverSize: PopoverSize) {
  if (placement === "bottom") {
    return rect.bottom + TARGET_GAP + popoverSize.height <= viewport.height - VIEWPORT_GUTTER;
  }

  if (placement === "top") {
    return rect.top - TARGET_GAP - popoverSize.height >= VIEWPORT_GUTTER;
  }

  if (placement === "right") {
    return rect.right + TARGET_GAP + popoverSize.width <= viewport.width - VIEWPORT_GUTTER;
  }

  return rect.left - TARGET_GAP - popoverSize.width >= VIEWPORT_GUTTER;
}

function getPopoverStyle(
  rect: HighlightRect | null,
  placement: ManualPlacement | undefined,
  viewport: ViewportSize,
  popoverSize: PopoverSize
): CSSProperties {
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewport.width - popoverSize.width - VIEWPORT_GUTTER);
  const maxTop = Math.max(VIEWPORT_GUTTER, viewport.height - popoverSize.height - VIEWPORT_GUTTER);

  if (!rect || placement === "center") {
    return {
      left: clamp((viewport.width - popoverSize.width) / 2, VIEWPORT_GUTTER, maxLeft),
      top: clamp((viewport.height - popoverSize.height) / 2, VIEWPORT_GUTTER, maxTop)
    };
  }

  const placementOrder = getPlacementOrder(placement);
  const resolvedPlacement =
    placementOrder.find((item): item is Exclude<ManualPlacement, "center"> => item !== "center" && hasRoom(rect, item, viewport, popoverSize)) ??
    (placementOrder[0] === "center" ? "bottom" : placementOrder[0]);

  let left = rect.left + rect.width / 2 - popoverSize.width / 2;
  let top = rect.bottom + TARGET_GAP;

  if (resolvedPlacement === "top") {
    top = rect.top - popoverSize.height - TARGET_GAP;
  } else if (resolvedPlacement === "right") {
    left = rect.right + TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  } else if (resolvedPlacement === "left") {
    left = rect.left - popoverSize.width - TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  }

  return {
    left: clamp(left, VIEWPORT_GUTTER, maxLeft),
    top: clamp(top, VIEWPORT_GUTTER, maxTop)
  };
}

export function ManualOverlay() {
  const { currentStepIndex, finishManual, isOpen, manual, nextStep, skipManual } = useManual();
  const popoverRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const scrollSettleFrameRef = useRef<number | null>(null);
  const scrollSettleTimeoutRef = useRef<number | null>(null);
  const controlledScrollRef = useRef(false);
  const lastGeometryRef = useRef<OverlayGeometry | null>(null);
  const [geometry, setGeometry] = useState<OverlayGeometry | null>(null);

  const step = manual?.steps[currentStepIndex] ?? null;
  const isFinalStep = Boolean(manual && currentStepIndex === manual.steps.length - 1);

  const updateGeometry = useCallback(() => {
    const popoverRect = popoverRef.current?.getBoundingClientRect();
    const nextGeometry: OverlayGeometry = {
      popoverSize: {
        height: roundNumber(popoverRect?.height || DEFAULT_POPOVER_SIZE.height),
        width: roundNumber(popoverRect?.width || DEFAULT_POPOVER_SIZE.width)
      },
      targetRect: normalizeRect(getElementRect(step?.selector)),
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth
      }
    };

    const previousGeometry = lastGeometryRef.current;

    if (previousGeometry && areGeometriesEqual(previousGeometry, nextGeometry)) {
      return;
    }

    lastGeometryRef.current = nextGeometry;
    setGeometry(nextGeometry);
  }, [step?.selector]);

  const scheduleGeometryUpdate = useCallback(() => {
    if (frameRef.current != null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      updateGeometry();
    });
  }, [updateGeometry]);

  const cancelScrollSettle = useCallback(() => {
    if (scrollSettleFrameRef.current != null) {
      window.cancelAnimationFrame(scrollSettleFrameRef.current);
      scrollSettleFrameRef.current = null;
    }

    if (scrollSettleTimeoutRef.current != null) {
      window.clearTimeout(scrollSettleTimeoutRef.current);
      scrollSettleTimeoutRef.current = null;
    }
  }, []);

  const waitForTargetToSettle = useCallback(
    (selector: string | undefined, onSettled: () => void) => {
      cancelScrollSettle();

      const startedAt = window.performance.now();
      let lastRect = normalizeRect(getElementRect(selector));
      let stableFrames = 0;
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cancelScrollSettle();
        onSettled();
      };

      const tick = () => {
        const nextRect = normalizeRect(getElementRect(selector));

        if (areRectsEqual(lastRect, nextRect)) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
          lastRect = nextRect;
        }

        const elapsed = window.performance.now() - startedAt;

        if (
          (stableFrames >= SCROLL_STABLE_FRAME_COUNT && elapsed >= SCROLL_MIN_SETTLE_MS) ||
          elapsed >= SCROLL_SETTLE_TIMEOUT_MS
        ) {
          finish();
          return;
        }

        scrollSettleFrameRef.current = window.requestAnimationFrame(tick);
      };

      scrollSettleFrameRef.current = window.requestAnimationFrame(tick);
      scrollSettleTimeoutRef.current = window.setTimeout(finish, SCROLL_SETTLE_TIMEOUT_MS + TARGET_REFRESH_DELAY_MS);

      return () => {
        settled = true;
        cancelScrollSettle();
      };
    },
    [cancelScrollSettle]
  );

  useEffect(() => {
    if (!isOpen || !step) {
      lastGeometryRef.current = null;
      setGeometry(null);
      return;
    }

    const handleScroll = () => {
      if (!controlledScrollRef.current) {
        scheduleGeometryUpdate();
      }
    };

    window.addEventListener("resize", scheduleGeometryUpdate, { passive: true });
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.removeEventListener("resize", scheduleGeometryUpdate);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen, scheduleGeometryUpdate, step]);

  useEffect(() => {
    if (!isOpen || !step) {
      controlledScrollRef.current = false;
      cancelScrollSettle();
      return;
    }

    let delayedRefresh: number | null = null;

    controlledScrollRef.current = true;
    lastGeometryRef.current = null;
    setGeometry(null);
    scrollTargetIntoView(step.selector);

    const stopWaiting = waitForTargetToSettle(step.selector, () => {
      controlledScrollRef.current = false;
      updateGeometry();
      delayedRefresh = window.setTimeout(scheduleGeometryUpdate, TARGET_REFRESH_DELAY_MS);
    });

    return () => {
      if (delayedRefresh != null) {
        window.clearTimeout(delayedRefresh);
      }

      controlledScrollRef.current = false;
      stopWaiting();
    };
  }, [cancelScrollSettle, currentStepIndex, isOpen, scheduleGeometryUpdate, step, updateGeometry, waitForTargetToSettle]);

  const spotlightStyle = useMemo<CSSProperties | undefined>(() => {
    const targetRect = geometry?.targetRect ?? null;

    if (!targetRect) {
      return undefined;
    }

    return {
      height: targetRect.height + SPOTLIGHT_PADDING * 2,
      left: targetRect.left - SPOTLIGHT_PADDING,
      top: targetRect.top - SPOTLIGHT_PADDING,
      width: targetRect.width + SPOTLIGHT_PADDING * 2
    };
  }, [geometry?.targetRect]);

  const popoverStyle = useMemo(() => {
    const viewport = geometry?.viewport ?? {
      height: typeof window === "undefined" ? DEFAULT_POPOVER_SIZE.height : window.innerHeight,
      width: typeof window === "undefined" ? DEFAULT_POPOVER_SIZE.width : window.innerWidth
    };

    return getPopoverStyle(geometry?.targetRect ?? null, step?.placement, viewport, geometry?.popoverSize ?? DEFAULT_POPOVER_SIZE);
  }, [geometry, step?.placement]);

  if (!manual || !step || !isOpen) {
    return null;
  }

  return (
    <>
      <div className={styles.ambientLayer} aria-hidden="true" />
      {spotlightStyle ? <div className={styles.spotlight} style={spotlightStyle} aria-hidden="true" /> : null}
      <section
        ref={popoverRef}
        className={styles.popover}
        style={popoverStyle}
        data-manual-popover="true"
        role="dialog"
        aria-live="polite"
        aria-label={`${manual.routeLabel} manual`}
      >
        <div className={styles.popoverTop}>
          <span>{manual.routeLabel}</span>
          <button
            className={styles.iconButton}
            type="button"
            onClick={skipManual}
            data-manual-control="true"
            aria-label="Skip manual"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className={styles.copy}>
          <h2>{step.title}</h2>
          <p>{step.body}</p>
        </div>

        <div className={styles.progressRow} aria-label={`Step ${currentStepIndex + 1} of ${manual.steps.length}`}>
          {manual.steps.map((manualStep, index) => (
            <span
              key={manualStep.id}
              className={`${styles.progressDot}${index <= currentStepIndex ? ` ${styles.progressDotActive}` : ""}`}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.skipButton} type="button" onClick={skipManual} data-manual-control="true">
            Skip
          </button>
          <button
            className={styles.nextButton}
            type="button"
            onClick={isFinalStep ? finishManual : nextStep}
            data-manual-control="true"
          >
            {isFinalStep ? (
              <>
                Finish
                <Check aria-hidden="true" />
              </>
            ) : (
              <>
                Next
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </section>
    </>
  );
}
