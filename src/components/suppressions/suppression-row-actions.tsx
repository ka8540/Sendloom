import clsx from "clsx";
import { Eye, Filter, Trash2 } from "lucide-react";

import styles from "./suppressions.module.css";

type SuppressionRowActionsProps = {
  isActive: boolean;
  isDeleting: boolean;
  onInspect: () => void;
  onFilter: () => void;
  onDelete: () => void;
};

export function SuppressionRowActions(props: SuppressionRowActionsProps) {
  return (
    <div className={styles.rowActions}>
      <button
        className={clsx(styles.rowActionButton, props.isActive ? styles.rowActionButtonActive : undefined)}
        type="button"
        onClick={props.onInspect}
        aria-label="Inspect recipient"
      >
        <Eye aria-hidden="true" />
      </button>

      <button className={styles.rowActionButton} type="button" onClick={props.onFilter} aria-label="Filter to recipient email">
        <Filter aria-hidden="true" />
      </button>

      <button
        className={clsx(styles.rowActionButton, styles.rowActionButtonDanger)}
        type="button"
        onClick={props.onDelete}
        aria-label="Delete suppression"
        disabled={props.isDeleting}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}
