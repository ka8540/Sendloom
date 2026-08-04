"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { SequenceRowData } from "@/components/dashboard/types";
import { SequenceRow } from "./sequence-row";
import styles from "./overview-command-center.module.css";

// The Overview preview intentionally shows only the three most recent
// sequences; the full list lives on the Sequences page behind "View all".
const RECENT_SEQUENCES_LIMIT = 3;
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
  const [refreshUntil, setRefreshUntil] = useState<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const resumeTimeoutRef = useRef<number | null>(null);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const nextRows = rows.filter((row) => {
      return (
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.summary.toLowerCase().includes(normalizedQuery)
      );
    });

    nextRows.sort((left, right) => right.updatedAtValue - left.updatedAtValue);

    return nextRows.slice(0, RECENT_SEQUENCES_LIMIT);
  }, [query, rows]);

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
    <section className={styles.sequenceSection} data-overview-tour="recent-sequences">
      <div className={styles.sequenceHead}>
        <div className={styles.sectionIntro}>
          <h2 className={styles.sectionTitle}>Recent sequences</h2>
          <p className={styles.sectionCopy}>Open, pause, or manage your recent runs.</p>
        </div>
        <div className={styles.sequenceTools}>
          <div className={styles.sequenceSearch}>
            <Search aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search recent sequences"
              placeholder="Search sequences…"
            />
          </div>
          <Link href="/campaigns" className={styles.viewAllButton} data-overview-tour="view-all-sequences">
            View all sequences
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.sequenceEmpty}>
          <div>
            <strong>No sequences yet</strong>
            <p>Import a list and create your first sequence to see it here.</p>
          </div>
          <Link href="/campaigns" className="button">
            Create Sequence
          </Link>
        </div>
      ) : visibleRows.length ? (
        <div className={styles.sequenceList}>
          {visibleRows.map((sequence, index) => (
            <SequenceRow
              key={sequence.id}
              sequence={sequence}
              onRelaunch={startRefreshWindow}
              tourTarget={index === 0}
            />
          ))}
        </div>
      ) : (
        <div className={styles.sequenceEmptyCompact} role="status">
          <Search aria-hidden="true" />
          <span>No sequences found</span>
        </div>
      )}
    </section>
  );
}
