"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

const TOOLTIP_DELAY_MS = 180;
const TOOLTIP_GAP_PX = 10;
const TOOLTIP_VIEWPORT_GUTTER_PX = 16;

type TooltipPlacement = "above" | "below";

function resolveTooltipPlacement(
  button: HTMLButtonElement | null,
  tooltip: HTMLSpanElement | null
): TooltipPlacement | null {
  const buttonRect = button?.getBoundingClientRect();
  const tooltipRect = tooltip?.getBoundingClientRect();

  if (!buttonRect || !tooltipRect) {
    return null;
  }

  const requiredSpace = tooltipRect.height + TOOLTIP_GAP_PX;
  const spaceAbove = buttonRect.top - TOOLTIP_VIEWPORT_GUTTER_PX;
  const spaceBelow = window.innerHeight - buttonRect.bottom - TOOLTIP_VIEWPORT_GUTTER_PX;

  return spaceAbove >= requiredSpace || spaceAbove >= spaceBelow ? "above" : "below";
}

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const tooltipId = useId();
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>("above");

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isTooltipVisible) {
      return;
    }

    const updateTooltipPlacement = () => {
      const nextPlacement = resolveTooltipPlacement(buttonRef.current, tooltipRef.current);

      if (nextPlacement) {
        setTooltipPlacement(nextPlacement);
      }
    };

    updateTooltipPlacement();
    window.addEventListener("resize", updateTooltipPlacement, { passive: true });

    return () => window.removeEventListener("resize", updateTooltipPlacement);
  }, [isTooltipVisible]);

  if (!manual || isOpen) {
    return null;
  }

  const clearTooltipTimer = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const updateTooltipPlacement = () => {
    const nextPlacement = resolveTooltipPlacement(buttonRef.current, tooltipRef.current);

    if (nextPlacement) {
      setTooltipPlacement(nextPlacement);
    }
  };

  const showTooltip = () => {
    clearTooltipTimer();
    updateTooltipPlacement();

    showTimerRef.current = window.setTimeout(() => {
      updateTooltipPlacement();
      setIsTooltipVisible(true);
      showTimerRef.current = null;
    }, TOOLTIP_DELAY_MS);
  };

  const hideTooltip = () => {
    clearTooltipTimer();
    setIsTooltipVisible(false);
  };

  return (
    <button
      ref={buttonRef}
      className={styles.helpButton}
      type="button"
      onClick={openManual}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      aria-label="Help"
      aria-describedby={isTooltipVisible ? tooltipId : undefined}
    >
      <CircleHelp aria-hidden="true" />
      <span
        id={tooltipId}
        ref={tooltipRef}
        className={`${styles.helpTooltip} ${
          tooltipPlacement === "above" ? styles.helpTooltipAbove : styles.helpTooltipBelow
        } ${isTooltipVisible ? styles.helpTooltipVisible : ""}`}
        role="tooltip"
        aria-hidden={!isTooltipVisible}
      >
        Help
      </span>
    </button>
  );
}
