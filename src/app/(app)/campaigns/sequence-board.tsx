"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";

import styles from "./page.module.css";

type SequencePaginationProps = {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
};

function SequencePagination({ page, totalPages, onPrev, onNext }: SequencePaginationProps) {
  return (
    <div className={styles.paginationControls}>
      <button
        type="button"
        className={styles.paginationButton}
        onClick={onPrev}
        disabled={page <= 1}
        aria-label="Previous sequences page"
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <span className={styles.paginationPage} aria-live="polite" aria-label={`Page ${page} of ${totalPages}`}>
        {page} / {totalPages}
      </span>
      <button
        type="button"
        className={styles.paginationButton}
        onClick={onNext}
        disabled={page >= totalPages}
        aria-label="Next sequences page"
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Client-side board for the Sequences page. Receives every sequence card pre-rendered
 * on the server and paginates them locally, so moving between pages only swaps the
 * visible slice — the route never re-renders, the page never jumps, and nothing else
 * on the screen remounts.
 */
export function SequenceBoard({
  cards,
  totalCount,
  pageSize
}: {
  cards: ReactNode[];
  totalCount: number;
  pageSize: number;
}) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (page - 1) * pageSize;
  const visibleCards = cards.slice(startIndex, startIndex + pageSize);
  const showPagination = totalPages > 1;

  function goToPrev() {
    setCurrentPage((value) => Math.max(1, Math.min(value, totalPages) - 1));
  }

  function goToNext() {
    setCurrentPage((value) => Math.min(totalPages, Math.min(value, totalPages) + 1));
  }

  return (
    <section className={styles.sequenceSection}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.kicker}>Sequence board</span>
          <h2>Sequences</h2>
          <p>Delivery posture, latest run, and setup context at a glance.</p>
        </div>
        <div className={styles.sectionHeaderAside}>
          <div className={styles.sectionMeta}>
            <Users aria-hidden="true" />
            <span>{totalCount} total</span>
          </div>
          {showPagination ? (
            <SequencePagination page={page} totalPages={totalPages} onPrev={goToPrev} onNext={goToNext} />
          ) : null}
        </div>
      </div>

      {cards.length ? (
        <div className={styles.sequenceList}>
          {visibleCards}
          {showPagination ? (
            <div className={styles.paginationBar}>
              <SequencePagination page={page} totalPages={totalPages} onPrev={goToPrev} onNext={goToNext} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>No sequences yet</strong>
          <p>Create your first sequence above to see delivery activity, timing, and validation status here.</p>
        </div>
      )}
    </section>
  );
}
