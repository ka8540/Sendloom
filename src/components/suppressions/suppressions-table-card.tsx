"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  CircleSlash,
  Eye,
  RotateCcw,
  Search,
  Trash2,
  X
} from "lucide-react";

import {
  formatSuppressionSource,
  SUPPRESSION_REASON_LABELS,
  SuppressionReasonBadge,
  SuppressionSourceBadge
} from "@/components/suppressions/suppression-badge";
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

const SORT_OPTIONS: Array<{ value: SuppressionSortOption; label: string }> = [
  { value: "updated-desc", label: "Newest first" },
  { value: "updated-asc", label: "Oldest first" },
  { value: "email-asc", label: "Email A-Z" },
  { value: "reason-asc", label: "Reason" },
  { value: "source-asc", label: "Source" }
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatRelativeDate(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  return formatDateTime(value);
}

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

  return (
    <section className={styles.dataCard}>
      <div className={styles.dataTopBar}>
        <div className={styles.dataHeaderMain}>
          <span className={styles.sectionEyebrow}>Suppressed recipients</span>
          <h2 className={styles.dataTitle}>Suppressed recipients</h2>
          <p className={styles.dataSubtitle}>Search, sort, inspect, and reverse blocks without leaving the workflow.</p>
        </div>

        <div className={styles.dataMetrics}>
          <div className={styles.dataMetric}>
            <span>Visible</span>
            <strong>{sortedRows.length}</strong>
          </div>
          <div className={styles.dataMetric}>
            <span>Automated</span>
            <strong>{automatedCount}</strong>
          </div>
          <div className={styles.dataMetric}>
            <span>Last update</span>
            <strong>{lastUpdatedAt ? formatRelativeDate(lastUpdatedAt) : "No activity"}</strong>
          </div>
        </div>
      </div>

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

      <div className={styles.toolbar}>
        <label className={styles.searchShell}>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by email, note, or source"
            aria-label="Search suppressions"
          />
        </label>

        <div className={styles.toolbarControls}>
          <label className={styles.filterGroup}>
            <span className={styles.filterLabel}>Reason</span>
            <div className={styles.controlShell}>
              <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value as "ALL" | SuppressionReason)}>
                <option value="ALL">All reasons</option>
                {Object.entries(SUPPRESSION_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className={styles.selectChevron} aria-hidden="true" />
            </div>
          </label>

          <label className={styles.filterGroup}>
            <span className={styles.filterLabel}>Source</span>
            <div className={styles.controlShell}>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="ALL">All sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {formatSuppressionSource(source)}
                  </option>
                ))}
              </select>
              <ChevronDown className={styles.selectChevron} aria-hidden="true" />
            </div>
          </label>

          <label className={styles.filterGroup}>
            <span className={styles.filterLabel}>Sort</span>
            <div className={styles.controlShell}>
              <select value={sort} onChange={(event) => setSort(event.target.value as SuppressionSortOption)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className={styles.selectChevron} aria-hidden="true" />
            </div>
          </label>

          {filtersActive ? (
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => {
                setSearch("");
                setReasonFilter("ALL");
                setSourceFilter("ALL");
                setSort("updated-desc");
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className={clsx(styles.dataShell, selectedSuppression ? styles.dataShellWithRail : undefined)}>
        <div className={styles.tableSurface}>
          <div className={styles.tableHeader}>
            <span>Recipient</span>
            <span>Reason</span>
            <span>Source</span>
            <span>Updated</span>
            <span className={styles.actionsHeader}>Actions</span>
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
                    <span className={styles.emailMeta}>{entry.notes?.trim() ? entry.notes : "No note attached"}</span>
                  </div>

                  <div className={styles.reasonCell}>
                    <SuppressionReasonBadge reason={entry.reason} />
                  </div>

                  <div className={styles.sourceCell}>
                    <SuppressionSourceBadge source={entry.source} />
                  </div>

                  <div className={styles.updatedCell}>
                    <span>{formatRelativeDate(entry.updatedAt)}</span>
                    <small>{formatDateTime(entry.updatedAt)}</small>
                  </div>

                  <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                    <button
                      className={clsx(styles.iconButton, entry.id === selectedId ? styles.iconButtonActive : undefined)}
                      type="button"
                      onClick={() => setSelectedId(entry.id)}
                      aria-label={`View ${entry.email}`}
                    >
                      <Eye aria-hidden="true" />
                    </button>
                    <button
                      className={clsx(styles.iconButton, styles.iconButtonDanger)}
                      type="button"
                      onClick={() => props.onDeleteSuppression(entry)}
                      aria-label={`Delete suppression for ${entry.email}`}
                      disabled={props.deletingId === entry.id}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <CircleSlash aria-hidden="true" />
                </div>
                <strong>No suppressed recipients yet</strong>
                <p>Add a suppression from the left, or wait for unsubscribe and bounce events to populate this list.</p>
              </div>
            )}
          </div>
        </div>

        {selectedSuppression ? (
          <aside className={styles.detailRail}>
            <div className={styles.detailRailHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Selected recipient</span>
                <h3>{selectedSuppression.email}</h3>
              </div>
              <button className={styles.iconButton} type="button" onClick={() => setSelectedId(null)} aria-label="Close details">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className={styles.detailPills}>
              <SuppressionReasonBadge reason={selectedSuppression.reason} />
              <SuppressionSourceBadge source={selectedSuppression.source} />
            </div>

            <dl className={styles.detailList}>
              <div className={styles.detailItem}>
                <dt>Created</dt>
                <dd>{formatDateTime(selectedSuppression.createdAt)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Updated</dt>
                <dd>{formatDateTime(selectedSuppression.updatedAt)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Source</dt>
                <dd>{formatSuppressionSource(selectedSuppression.source)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>Reason</dt>
                <dd>{SUPPRESSION_REASON_LABELS[selectedSuppression.reason]}</dd>
              </div>
            </dl>

            <div className={styles.notePanel}>
              <span className={styles.notePanelLabel}>Internal note</span>
              <p>{selectedSuppression.notes?.trim() || "No note provided for this suppression."}</p>
            </div>

            <div className={styles.detailActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setSearch(selectedSuppression.email)}>
                Filter to this email
              </button>
              <button
                className={styles.destructiveButton}
                type="button"
                onClick={() => props.onDeleteSuppression(selectedSuppression)}
                disabled={props.deletingId === selectedSuppression.id}
              >
                {props.deletingId === selectedSuppression.id ? "Removing..." : "Delete suppression"}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
