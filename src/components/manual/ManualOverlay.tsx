"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, X } from "lucide-react";

import { renderBrandText } from "@/components/brand-text";
import { useManual } from "@/components/manual/ManualProvider";
import {
  getPopoverStyle,
  type HighlightRect,
  type PopoverSize,
  type ViewportSize
} from "@/components/manual/overlayPosition";
import styles from "@/components/manual/manual.module.css";

type OverlayGeometry = {
  popoverSize: PopoverSize;
  targetRect: HighlightRect | null;
  viewport: ViewportSize;
};

const SPOTLIGHT_PADDING = 8;
const TARGET_REFRESH_DELAY_MS = 90;
const SCROLL_MIN_SETTLE_MS = 160;
const SCROLL_SETTLE_TIMEOUT_MS = 950;
const SCROLL_STABLE_FRAME_COUNT = 4;
const DEFAULT_POPOVER_SIZE: PopoverSize = {
  height: 244,
  width: 348
};

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

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollTargetIntoView(selector: string | undefined, block: ScrollLogicalPosition) {
  const target = getTargetElement(selector);

  if (!target) {
    return false;
  }

  // `block: "nearest"` (the Overview default) reveals the target with the
  // minimum scroll instead of yanking it to the viewport centre — the latter
  // pushed tall in-card targets (e.g. Sequence health) into a jarring reframe
  // that looked like the dashboard had stretched. Reduced motion skips the
  // smooth animation. Scrolling never resizes the page or any card.
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block,
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

export function ManualOverlay() {
  const { currentStepIndex, finishManual, isOpen, manual, nextStep, skipManual, steps } = useManual();
  const popoverRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const scrollSettleFrameRef = useRef<number | null>(null);
  const scrollSettleTimeoutRef = useRef<number | null>(null);
  const controlledScrollRef = useRef(false);
  const lastGeometryRef = useRef<OverlayGeometry | null>(null);
  const [geometry, setGeometry] = useState<OverlayGeometry | null>(null);

  const step = steps[currentStepIndex] ?? null;
  const isFinalStep = steps.length > 0 && currentStepIndex === steps.length - 1;

  // Escape closes the tour; focus moves into the popover when it opens so
  // keyboard and screen-reader users land on the guidance.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        skipManual();
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isOpen, skipManual]);

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
    scrollTargetIntoView(step.selector, manual?.scrollBlock ?? "center");

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
  }, [cancelScrollSettle, currentStepIndex, isOpen, manual?.scrollBlock, scheduleGeometryUpdate, step, updateGeometry, waitForTargetToSettle]);

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

  if (!manual || !step || !isOpen || typeof document === "undefined") {
    return null;
  }

  // Render the spotlight + coachmark in a body-level portal, fully outside the
  // dashboard's document flow. They are `position: fixed` (viewport-relative)
  // and never become a child of the highlighted target or the Overview grid, so
  // opening/advancing/closing the tour cannot resize or move any dashboard card.
  return createPortal(
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
        tabIndex={-1}
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
          <h2>{renderBrandText(step.title)}</h2>
          <p>{renderBrandText(step.body)}</p>
        </div>

        <div className={styles.progressRow} aria-label={`Step ${currentStepIndex + 1} of ${steps.length}`}>
          {steps.map((manualStep, index) => (
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
    </>,
    document.body
  );
}
