"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

const TOOLTIP_DELAY_MS = 180;

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const tooltipId = useId();
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  if (!manual || isOpen) {
    return null;
  }

  const clearTooltipTimer = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const showTooltip = () => {
    clearTooltipTimer();

    showTimerRef.current = window.setTimeout(() => {
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
        className={`${styles.helpTooltip} ${isTooltipVisible ? styles.helpTooltipVisible : ""}`}
        role="tooltip"
        aria-hidden={!isTooltipVisible}
      >
        Help
      </span>
    </button>
  );
}
