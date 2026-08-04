"use client";

import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";

import styles from "./analysis.module.css";

export function AnalysisInfo({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className={styles.infoShell}>
      <button className={styles.infoTrigger} type="button" aria-label={label} aria-describedby={id}>
        <Info aria-hidden="true" />
      </button>
      <span className={styles.infoTooltip} id={id} role="tooltip">
        {children}
      </span>
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
          <AnalysisInfo label={`About ${title}`}>{info}</AnalysisInfo>
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
