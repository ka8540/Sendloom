import { formatRelativeDate } from "@/components/suppressions/formatters";

import styles from "./suppressions.module.css";

type SuppressionLogHeaderProps = {
  visibleCount: number;
  automatedCount: number;
  lastUpdatedAt: string | null;
};

export function SuppressionLogHeader({ visibleCount, automatedCount, lastUpdatedAt }: SuppressionLogHeaderProps) {
  return (
    <div className={styles.logHeader}>
      <div className={styles.logHeaderCopy}>
        <span className={styles.sectionEyebrow}>Suppressed recipients</span>
        <h2 className={styles.logTitle}>Suppression log</h2>
        <p className={styles.logSubtitle}>Scan the list, narrow the view, and take action without breaking flow.</p>
      </div>

      <div className={styles.logMetrics}>
        <span className={styles.logMetric}>
          <small>Visible</small>
          <strong>{visibleCount}</strong>
        </span>
        <span className={styles.logMetric}>
          <small>Automated</small>
          <strong>{automatedCount}</strong>
        </span>
        <span className={styles.logMetric}>
          <small>Updated</small>
          <strong>{lastUpdatedAt ? formatRelativeDate(lastUpdatedAt) : "No activity"}</strong>
        </span>
      </div>
    </div>
  );
}
