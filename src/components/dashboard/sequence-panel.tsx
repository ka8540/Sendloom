"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { SequenceRowData } from "@/components/dashboard/types";
import { SequenceRow } from "./sequence-row";
import styles from "./overview-command-center.module.css";

const PAGE_SIZE = 10;
const OVERVIEW_REFRESH_INTERVAL_MS = 4_000;
const RELAUNCH_REFRESH_WINDOW_MS = 30_000;
const RESUME_REFRESH_DELAY_MS = 250;

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function SequencePanel({ rows }: { rows: SequenceRowData[] }) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [focus, setFocus] = useState("recent");
  const [sort, setSort] = useState("activity");
  const [currentPage, setCurrentPage] = useState(1);
  const [refreshUntil, setRefreshUntil] = useState<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const resumeTimeoutRef = useRef<number | null>(null);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const nextRows = rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.summary.toLowerCase().includes(normalizedQuery);
      const matchesStatus = status === "all" || row.statusTone === status;
      const matchesFocus =
        focus === "recent" ||
        (focus === "attention" && row.needsAttention) ||
        (focus === "validated" && row.isValidated) ||
        (focus === "running" && row.statusTone === "running");

      return matchesQuery && matchesStatus && matchesFocus;
    });

    nextRows.sort((left, right) => {
      if (sort === "name") {
        return left.name.localeCompare(right.name);
      }

      if (sort === "progress") {
        return right.progressPercent - left.progressPercent;
      }

      return right.updatedAtValue - left.updatedAtValue;
    });

    return nextRows;
  }, [focus, query, rows, sort, status]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [clampedPage, filteredRows]
  );
  const showingFrom = filteredRows.length ? (clampedPage - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(clampedPage * PAGE_SIZE, filteredRows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, status, focus, sort]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const hasActiveRuns = rows.some((row) => row.statusTone === "running");

  useEffect(() => {
    refreshInFlightRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    if (!hasActiveRuns && !refreshUntil) {
      return;
    }

    function refreshIfVisible() {
      if (!isDocumentVisible()) {
        return;
      }

      if (!hasActiveRuns && refreshUntil && Date.now() > refreshUntil) {
        setRefreshUntil(null);
        return;
      }

      if (refreshInFlightRef.current) {
        return;
      }

      refreshInFlightRef.current = true;
      startRefresh(() => {
        router.refresh();
      });
    }

    const interval = window.setInterval(() => {
      refreshIfVisible();
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    function handleVisibilityChange() {
      if (!isDocumentVisible()) {
        return;
      }

      if (resumeTimeoutRef.current !== null) {
        window.clearTimeout(resumeTimeoutRef.current);
      }

      resumeTimeoutRef.current = window.setTimeout(() => {
        resumeTimeoutRef.current = null;
        refreshIfVisible();
      }, RESUME_REFRESH_DELAY_MS);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (resumeTimeoutRef.current !== null) {
        window.clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }
    };
  }, [hasActiveRuns, refreshUntil, router, startRefresh]);

  function startRefreshWindow() {
    setRefreshUntil(Date.now() + RELAUNCH_REFRESH_WINDOW_MS);
  }

  return (
    <>
      <div className={styles.toolbar}>
        <label className={`${styles.toolbarField} ${styles.toolbarFieldWide}`}>
          <span className={styles.toolbarLabel}>Search</span>
          <div className={styles.toolbarSearch}>
            <Search aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search recent sequences"
              placeholder="Search sequence, template, or sender"
            />
          </div>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Status</span>
          <div className={styles.toolbarSelect}>
            <select aria-label="Filter recent sequences by status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All states</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Needs attention</option>
              <option value="scheduled">Scheduled</option>
              <option value="draft">Draft</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Focus</span>
          <div className={styles.toolbarSelect}>
            <select aria-label="Filter recent sequences by focus" value={focus} onChange={(event) => setFocus(event.target.value)}>
              <option value="recent">All recent</option>
              <option value="running">Running now</option>
              <option value="validated">Validated</option>
              <option value="attention">Needs attention</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
        </label>
        <label className={styles.toolbarField}>
          <span className={styles.toolbarLabel}>Sort</span>
          <div className={styles.toolbarSelect}>
            <select aria-label="Sort recent sequences" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="activity">Latest activity</option>
              <option value="progress">Progress</option>
              <option value="name">Name</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
        </label>
      </div>

      {filteredRows.length ? (
        <>
          <div className={styles.sequenceList}>
            {pagedRows.map((sequence) => (
              <SequenceRow key={sequence.id} sequence={sequence} onRelaunch={startRefreshWindow} />
            ))}
          </div>
          <div className={styles.sequencePagination}>
            <span className={styles.sequencePaginationSummary}>
              Showing {showingFrom}-{showingTo} of {filteredRows.length}
            </span>
            <div className={styles.sequencePaginationControls}>
              <button
                type="button"
                className={styles.sequencePaginationButton}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={clampedPage === 1}
                aria-label="Show previous sequences"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span className={styles.sequencePaginationPage}>
                {clampedPage} / {totalPages}
              </span>
              <button
                type="button"
                className={styles.sequencePaginationButton}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={clampedPage === totalPages}
                aria-label="Show next sequences"
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.sequenceEmpty}>
          <Search aria-hidden="true" />
          <div>
            <strong>No sequences match this view</strong>
            <p>Adjust the search or filters, or create a fresh sequence to give the command center something new to work with.</p>
          </div>
          <Link href="/campaigns" className="button">
            Create Sequence
          </Link>
        </div>
      )}
    </>
  );
}
