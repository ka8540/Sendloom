import { X } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import { formatSuppressionSource, SUPPRESSION_REASON_LABELS } from "@/components/suppressions/suppression-badge";
import type { SuppressionRecord } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

type SuppressionSidePanelProps = {
  suppression: SuppressionRecord;
  isDeleting: boolean;
  onFilterByEmail: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function SuppressionSidePanel(props: SuppressionSidePanelProps) {
  return (
    <aside className={styles.sidePanel}>
      <div className={styles.sidePanelHeader}>
        <div className={styles.sidePanelTitleBlock}>
          <span className={styles.sectionEyebrow}>Selected recipient</span>
          <h3 className={styles.sidePanelTitle}>{props.suppression.email}</h3>
        </div>

        <button className={styles.iconButton} type="button" onClick={props.onClose} aria-label="Close details">
          <X aria-hidden="true" />
        </button>
      </div>

      <dl className={styles.sidePanelMeta}>
        <div>
          <dt>Created</dt>
          <dd>
            <LocalDateTime value={props.suppression.createdAt} />
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            <LocalDateTime value={props.suppression.updatedAt} />
          </dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{SUPPRESSION_REASON_LABELS[props.suppression.reason]}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{formatSuppressionSource(props.suppression.source)}</dd>
        </div>
      </dl>

      <div className={styles.notePanel}>
        <span className={styles.notePanelLabel}>Internal note</span>
        <p>{props.suppression.notes?.trim() || "No note provided for this suppression."}</p>
      </div>

      <div className={styles.sidePanelActions}>
        <button className={styles.secondaryButton} type="button" onClick={props.onFilterByEmail}>
          Filter to this email
        </button>
        <button className={styles.destructiveButton} type="button" onClick={props.onDelete} disabled={props.isDeleting}>
          {props.isDeleting ? "Removing..." : "Delete suppression"}
        </button>
      </div>
    </aside>
  );
}
