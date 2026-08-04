"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

import styles from "./analysis.module.css";

export function AnalysisInfo({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const anchor = trigger.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const pad = 16;
    let top = anchor.top - box.height - 10;
    if (top < pad) top = anchor.bottom + 10;
    const left = Math.max(pad, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - pad));
    setPosition((prev) => (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 ? prev : { top, left }));
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const track = () => {
      place();
      frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, place]);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  return (
    <span className={styles.infoShell} onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={triggerRef}
        className={styles.infoTrigger}
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        <Info aria-hidden="true" />
      </button>
      {open
        ? createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            className={styles.infoTooltip}
            style={position ? { top: `${position.top}px`, left: `${position.left}px` } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {title ? <strong>{title}</strong> : null}
            {children}
          </span>,
          document.body
        )
        : null}
    </span>
  );
}

export function AnalysisCard({
  title,
  info,
  children,
  className,
  summary,
  action
}: {
  title: string;
  info: string;
  children: ReactNode;
  className?: string;
  summary: string;
  action?: ReactNode;
}) {
  return (
    <section className={`${styles.card}${className ? ` ${className}` : ""}`} aria-label={title}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2>{title}</h2>
          <AnalysisInfo label={`About ${title}`} title={title}>{info}</AnalysisInfo>
        </div>
        {action}
      </div>
      <p className={styles.srOnly}>{summary}</p>
      {children}
    </section>
  );
}

export function AnalysisEmpty({ children = "No outreach data is available for this date range." }: { children?: ReactNode }) {
  return (
    <div className={styles.emptyState} role="status">
      <span className={styles.emptyMark} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function formatAnalysisNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export const analysisColors = {
  green: "var(--analysis-green)",
  blue: "var(--analysis-blue)",
  purple: "var(--analysis-purple)",
  orange: "var(--analysis-orange)",
  red: "var(--analysis-red)",
  teal: "var(--analysis-teal)",
  muted: "var(--analysis-muted-fill)"
} as const;
