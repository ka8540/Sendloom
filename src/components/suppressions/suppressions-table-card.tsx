"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { CircleSlash, RotateCcw } from "lucide-react";

import { formatSuppressionSource, SUPPRESSION_REASON_LABELS } from "@/components/suppressions/suppression-badge";
import { SuppressionLogHeader } from "@/components/suppressions/suppression-log-header";
import { SuppressionLogToolbar } from "@/components/suppressions/suppression-log-toolbar";
import { SuppressionSidePanel } from "@/components/suppressions/suppression-side-panel";
import type { SuppressionReason, SuppressionRecord, SuppressionSortOption } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

type SuppressionsTableCardProps = {
  suppressions: SuppressionRecord[];
  preferredSelectionId: string | null;
  pendingUndo: SuppressionRecord | null;
  feedback: { tone: "success" | "error"; message: string } | null;
  deletingId: string | null;
  isUndoPending: boolean;
  onDeleteSuppression: (suppression: SuppressionRecord) => void;
  onUndoDelete: () => void;
};

export function SuppressionsTableCard(props: SuppressionsTableCardProps) {
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<"ALL" | SuppressionReason>("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [sort, setSort] = useState<SuppressionSortOption>("updated-desc");
  const [selectedId, setSelectedId] = useState<string | null>(props.preferredSelectionId);

  useEffect(() => {
    if (props.preferredSelectionId) {
      setSelectedId(props.preferredSelectionId);
    }
  }, [props.preferredSelectionId]);

  const sourceOptions = Array.from(new Set(props.suppressions.map((entry) => entry.source))).sort((left, right) =>
    formatSuppressionSource(left).localeCompare(formatSuppressionSource(right))
  );

  const filteredRows = props.suppressions.filter((entry) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      entry.email.toLowerCase().includes(query) ||
      entry.source.toLowerCase().includes(query) ||
      entry.notes?.toLowerCase().includes(query);

    const matchesReason = reasonFilter === "ALL" || entry.reason === reasonFilter;
    const matchesSource = sourceFilter === "ALL" || entry.source === sourceFilter;

    return matchesSearch && matchesReason && matchesSource;
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    switch (sort) {
      case "updated-asc":
        return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
      case "email-asc":
        return left.email.localeCompare(right.email);
      case "reason-asc":
        return SUPPRESSION_REASON_LABELS[left.reason].localeCompare(SUPPRESSION_REASON_LABELS[right.reason]);
      case "source-asc":
        return formatSuppressionSource(left.source).localeCompare(formatSuppressionSource(right.source));
      case "updated-desc":
      default:
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    }
  });

  useEffect(() => {
    if (!sortedRows.length) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }

    if (selectedId && sortedRows.some((entry) => entry.id === selectedId)) {
      return;
    }

    setSelectedId(sortedRows[0].id);
  }, [selectedId, sortedRows]);

  const selectedSuppression = sortedRows.find((entry) => entry.id === selectedId) ?? null;
  const filtersActive = Boolean(search.trim()) || reasonFilter !== "ALL" || sourceFilter !== "ALL";
  const automatedCount = props.suppressions.filter((entry) => entry.source !== "manual").length;
  const lastUpdatedAt = props.suppressions[0]?.updatedAt ?? null;

  function clearFilters() {
    setSearch("");
    setReasonFilter("ALL");
    setSourceFilter("ALL");
    setSort("updated-desc");
  }

  return (
    <section className={styles.dataCard}>
      <SuppressionLogHeader visibleCount={sortedRows.length} automatedCount={automatedCount} lastUpdatedAt={lastUpdatedAt} />

      {props.feedback ? (
        <div className={clsx(styles.feedbackBanner, props.feedback.tone === "error" ? styles.feedbackError : styles.feedbackSuccess)}>
          <span>{props.feedback.message}</span>
        </div>
      ) : null}

      {props.pendingUndo ? (
        <div className={styles.undoBanner}>
          <div className={styles.undoCopy}>
            <RotateCcw aria-hidden="true" />
            <span>
              Removed <strong>{props.pendingUndo.email}</strong>. Restore it if this was a mistake.
            </span>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={props.onUndoDelete} disabled={props.isUndoPending}>
            {props.isUndoPending ? "Restoring..." : "Undo"}
          </button>
        </div>
      ) : null}

      <SuppressionLogToolbar
        search={search}
        reasonFilter={reasonFilter}
        sourceFilter={sourceFilter}
        sort={sort}
        sourceOptions={sourceOptions}
        filtersActive={filtersActive}
        onSearchChange={setSearch}
        onReasonFilterChange={setReasonFilter}
        onSourceFilterChange={setSourceFilter}
        onSortChange={setSort}
        onClear={clearFilters}
      />

      <div className={clsx(styles.logContent, selectedSuppression ? styles.logContentWithPanel : undefined)}>
        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <span>Recipient</span>
          </div>

          <div className={styles.tableBody}>
            {sortedRows.length ? (
              sortedRows.map((entry) => (
                <div
                  key={entry.id}
                  className={clsx(styles.tableRow, entry.id === selectedId ? styles.tableRowActive : undefined)}
                  onClick={() => setSelectedId(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(entry.id);
                    }
                  }}
                >
                  <div className={styles.emailCell}>
                    <span className={styles.emailValue}>{entry.email}</span>
                    <span className={styles.emailMeta}>{entry.notes?.trim() ? entry.notes : "No internal note attached."}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <CircleSlash aria-hidden="true" />
                </div>
                <strong>No suppressed recipients match this view.</strong>
                <p>Adjust the search or filters, or add a new suppression from the left-hand control panel.</p>
              </div>
            )}
          </div>
        </div>

        {selectedSuppression ? (
          <SuppressionSidePanel
            suppression={selectedSuppression}
            isDeleting={props.deletingId === selectedSuppression.id}
            onFilterByEmail={() => setSearch(selectedSuppression.email)}
            onDelete={() => props.onDeleteSuppression(selectedSuppression)}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </section>
  );
}
