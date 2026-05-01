"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
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

const SPOTLIGHT_PADDING = 8;
const POPOVER_WIDTH = 348;
const VIEWPORT_GUTTER = 18;
const TARGET_REFRESH_DELAY_MS = 90;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getElementRect(selector?: string): HighlightRect | null {
  if (!selector) {
    return null;
  }

  const target = document.querySelector(selector);

  if (!(target instanceof HTMLElement)) {
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

function getPopoverStyle(rect: HighlightRect | null, placement: ManualPlacement | undefined, viewport: ViewportSize | null): CSSProperties {
  if (!rect || !viewport || placement === "center") {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)"
    };
  }

  const resolvedPlacement = placement ?? "bottom";
  const maxLeft = viewport.width - POPOVER_WIDTH - VIEWPORT_GUTTER;
  const centeredLeft = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
  let left = clamp(centeredLeft, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, maxLeft));
  let top = rect.bottom + 16;
  let transform: string | undefined;

  if (resolvedPlacement === "top") {
    top = rect.top - 16;
    transform = "translateY(-100%)";
  }

  if (resolvedPlacement === "left") {
    left = Math.max(VIEWPORT_GUTTER, rect.left - POPOVER_WIDTH - 16);
    top = clamp(rect.top + rect.height / 2, VIEWPORT_GUTTER, viewport.height - VIEWPORT_GUTTER);
    transform = "translateY(-50%)";
  }

  if (resolvedPlacement === "right") {
    left = Math.min(rect.right + 16, maxLeft);
    top = clamp(rect.top + rect.height / 2, VIEWPORT_GUTTER, viewport.height - VIEWPORT_GUTTER);
    transform = "translateY(-50%)";
  }

  if (resolvedPlacement === "bottom" && top + 220 > viewport.height) {
    top = rect.top - 16;
    transform = "translateY(-100%)";
  }

  return {
    left,
    top,
    transform
  };
}

export function ManualOverlay() {
  const { currentStepIndex, finishManual, isOpen, manual, nextStep, skipManual } = useManual();
  const [targetRect, setTargetRect] = useState<HighlightRect | null>(null);
  const [viewport, setViewport] = useState<ViewportSize | null>(null);

  const step = manual?.steps[currentStepIndex] ?? null;
  const isFinalStep = Boolean(manual && currentStepIndex === manual.steps.length - 1);

  useEffect(() => {
    if (!isOpen || !step) {
      setTargetRect(null);
      return;
    }

    let frame = 0;

    const updateTarget = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewport({
          height: window.innerHeight,
          width: window.innerWidth
        });
        setTargetRect(getElementRect(step.selector));
      });
    };

    const timer = window.setTimeout(updateTarget, TARGET_REFRESH_DELAY_MS);
    updateTarget();

    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [isOpen, step]);

  const spotlightStyle = useMemo<CSSProperties | undefined>(() => {
    if (!targetRect) {
      return undefined;
    }

    return {
      height: targetRect.height + SPOTLIGHT_PADDING * 2,
      left: targetRect.left - SPOTLIGHT_PADDING,
      top: targetRect.top - SPOTLIGHT_PADDING,
      width: targetRect.width + SPOTLIGHT_PADDING * 2
    };
  }, [targetRect]);

  const popoverStyle = useMemo(
    () => getPopoverStyle(targetRect, step?.placement, viewport),
    [step?.placement, targetRect, viewport]
  );

  if (!manual || !step || !isOpen) {
    return null;
  }

  return (
    <>
      <div className={styles.ambientLayer} aria-hidden="true" />
      {spotlightStyle ? <div className={styles.spotlight} style={spotlightStyle} aria-hidden="true" /> : null}
      <section
        className={styles.popover}
        style={popoverStyle}
        role="dialog"
        aria-live="polite"
        aria-label={`${manual.routeLabel} manual`}
      >
        <div className={styles.popoverTop}>
          <span>{manual.routeLabel}</span>
          <button className={styles.iconButton} type="button" onClick={skipManual} aria-label="Skip manual">
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
          <button className={styles.skipButton} type="button" onClick={skipManual}>
            Skip
          </button>
          <button className={styles.nextButton} type="button" onClick={isFinalStep ? finishManual : nextStep}>
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
