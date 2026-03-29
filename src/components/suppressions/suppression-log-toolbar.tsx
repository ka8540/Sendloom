import { Search } from "lucide-react";

import { formatSuppressionSource, SUPPRESSION_REASON_LABELS } from "@/components/suppressions/suppression-badge";
import type { SuppressionReason, SuppressionSortOption } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

type SuppressionLogToolbarProps = {
  search: string;
  reasonFilter: "ALL" | SuppressionReason;
  sourceFilter: string;
  sort: SuppressionSortOption;
  sourceOptions: string[];
  filtersActive: boolean;
  onSearchChange: (value: string) => void;
  onReasonFilterChange: (value: "ALL" | SuppressionReason) => void;
  onSourceFilterChange: (value: string) => void;
  onSortChange: (value: SuppressionSortOption) => void;
  onClear: () => void;
};

const SORT_OPTIONS: Array<{ value: SuppressionSortOption; label: string }> = [
  { value: "updated-desc", label: "Newest first" },
  { value: "updated-asc", label: "Oldest first" },
  { value: "email-asc", label: "Email A-Z" },
  { value: "reason-asc", label: "Reason" },
  { value: "source-asc", label: "Source" }
];

export function SuppressionLogToolbar(props: SuppressionLogToolbarProps) {
  return (
    <div className={styles.toolbarBar}>
      <label className={styles.toolbarSearch}>
        <Search aria-hidden="true" />
        <input
          type="search"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="Search by email, note, or source"
          aria-label="Search suppressions"
        />
      </label>

      <div className={styles.toolbarSelects}>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Reason</span>
          <select value={props.reasonFilter} onChange={(event) => props.onReasonFilterChange(event.target.value as "ALL" | SuppressionReason)}>
            <option value="ALL">All reasons</option>
            {Object.entries(SUPPRESSION_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Source</span>
          <select value={props.sourceFilter} onChange={(event) => props.onSourceFilterChange(event.target.value)}>
            <option value="ALL">All sources</option>
            {props.sourceOptions.map((source) => (
              <option key={source} value={source}>
                {formatSuppressionSource(source)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Sort</span>
          <select value={props.sort} onChange={(event) => props.onSortChange(event.target.value as SuppressionSortOption)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {props.filtersActive ? (
        <button className={styles.ghostButton} type="button" onClick={props.onClear}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
