"use client";

// The sequence board that lives below the create form: summary values,
// status filters with counts, search, and a minimal 5-per-page list. Rows
// stay scannable — name, status pill, one list chip, health, enrolled, and
// the open/delete actions. Deeper analysis lives on the sequence detail page.

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Search, Users } from "lucide-react";

import { CampaignCardActions } from "@/components/campaign-card-actions";
import {
  SEQUENCE_FILTERS,
  SEQUENCE_TONE_LABELS,
  countSequenceFilters,
  describeSequencePagePreview,
  filterSequenceItems,
  paginateSequenceItems,
  primarySequenceTone,
  type SequenceFilterId,
  type SequenceListItem
} from "@/lib/sequence-dashboard";
import styles from "./sequence-dashboard.module.css";

const countFormatter = new Intl.NumberFormat("en-US");

function formatCount(value: number) {
  return countFormatter.format(value);
}

function SequenceRow({ item }: { item: SequenceListItem }) {
  const tone = primarySequenceTone(item);

  return (
    <li className={styles.row} data-tone={tone}>
      <Link
        href={`/campaigns/${item.id}`}
        className={styles.rowLink}
        aria-label={`Open sequence ${item.name}`}
      >
        <span className={styles.rowIdentity}>
          <span className={styles.rowDot} data-tone={tone} aria-hidden="true" />
          <span className={styles.rowTitleBlock}>
            <span className={styles.rowName} title={item.name}>
              {item.name}
            </span>
            <span className={styles.rowChip} title={`Contact list: ${item.listName}`}>
              <Users aria-hidden="true" />
              <span>{item.listName}</span>
            </span>
          </span>
        </span>

        <span className={styles.rowHealth}>
          <span className={styles.rowHealthValue}>
            {item.healthPercent === null ? "—" : `${item.healthPercent}%`}
          </span>
          <span className={styles.rowTrack} aria-hidden="true">
            <span className={styles.rowTrackFill} style={{ width: `${item.progressPercent}%` }} />
          </span>
        </span>

        <span className={styles.rowEnrolled}>
          <span className={styles.rowEnrolledValue}>{formatCount(item.enrolledCount)}</span>
          <span className={styles.rowEnrolledLabel}>enrolled</span>
        </span>

        <span className={styles.rowStatus} data-tone={tone}>
          {SEQUENCE_TONE_LABELS[tone]}
        </span>
      </Link>

      <span className={styles.rowActions}>
        <CampaignCardActions campaignId={item.id} campaignName={item.name} />
      </span>
    </li>
  );
}

export function SequenceDashboard({ items }: { items: SequenceListItem[] }) {
  const [filter, setFilter] = useState<SequenceFilterId>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const previewBaseId = useId();

  const counts = useMemo(() => countSequenceFilters(items), [items]);
  const filtered = useMemo(() => filterSequenceItems(items, filter, query), [items, filter, query]);
  const slice = paginateSequenceItems(filtered, page);

  // Draft is only offered when draft sequences exist; the six core filters
  // always render, including zero counts.
  const visibleFilters = SEQUENCE_FILTERS.filter(
    (entry) => entry.id !== "draft" || counts.draft > 0
  );

  const prevPreview =
    slice.page > 1
      ? describeSequencePagePreview(paginateSequenceItems(filtered, slice.page - 1).pageItems)
      : null;
  const nextPreview =
    slice.page < slice.totalPages
      ? describeSequencePagePreview(paginateSequenceItems(filtered, slice.page + 1).pageItems)
      : null;

  function selectFilter(next: SequenceFilterId) {
    setFilter(next);
    setPage(1);
  }

  function onSearchChange(value: string) {
    setQuery(value);
    setPage(1);
  }

  function clearFilters() {
    setFilter("all");
    setQuery("");
    setPage(1);
  }

  const hasSequences = items.length > 0;
  const hasResults = filtered.length > 0;

  return (
    <section className={styles.dashboard} aria-label="Sequence dashboard">
      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <span className={styles.kicker}>Sequence board</span>
          <h2 className={styles.title}>Sequences</h2>
          <p className={styles.subtitle}>
            Track launches, delivery health, and sequences that need attention.
          </p>
        </div>

        <dl className={styles.summaryStrip} aria-label="Sequence summary">
          <div className={styles.summaryItem}>
            <dt>Total</dt>
            <dd>{formatCount(counts.all)}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>Active</dt>
            <dd>{formatCount(counts.active)}</dd>
          </div>
          <div className={styles.summaryItem} data-tone="attention">
            <dt>Needs attention</dt>
            <dd>{formatCount(counts.attention)}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>Completed</dt>
            <dd>{formatCount(counts.completed)}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filterRail} role="group" aria-label="Filter sequences by status">
          {visibleFilters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={styles.filterPill}
              data-tone={entry.id}
              aria-pressed={filter === entry.id}
              onClick={() => selectFilter(entry.id)}
            >
              <span className={styles.filterDot} aria-hidden="true" />
              <span className={styles.filterLabel}>{entry.label}</span>
              <span className={styles.filterCount}>{formatCount(counts[entry.id])}</span>
            </button>
          ))}
        </div>

        <div className={styles.search}>
          <Search aria-hidden="true" className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            value={query}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search sequences…"
            aria-label="Search sequences by name, list, template, or sender"
          />
        </div>
      </div>

      {!hasSequences ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Inbox />
          </span>
          <strong className={styles.emptyTitle}>No sequences yet</strong>
          <p className={styles.emptyCopy}>
            Create your first sequence or import a list to get started.
          </p>
          <div className={styles.emptyActions}>
            <a className="button" href="#create-sequence">
              Create sequence
            </a>
            <Link className="button secondary" href="/imports">
              Import list
            </Link>
          </div>
        </div>
      ) : !hasResults ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Search />
          </span>
          <strong className={styles.emptyTitle}>No sequences match this filter</strong>
          <p className={styles.emptyCopy}>Try another status or clear search.</p>
          <div className={styles.emptyActions}>
            <button type="button" className="button secondary" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.rangeLine} aria-live="polite">
            {slice.rangeLabel}
          </p>

          <ul className={styles.list}>
            {slice.pageItems.map((item) => (
              <SequenceRow key={item.id} item={item} />
            ))}
          </ul>

          {slice.totalPages > 1 ? (
            <nav className={styles.pagination} aria-label="Sequences pages">
              <span className={styles.paginationHint}>{slice.rangeLabel}</span>
              <div className={styles.paginationControls}>
                <span className={styles.pageButtonWrap}>
                  <button
                    type="button"
                    className={styles.pageButton}
                    onClick={() => setPage(slice.page - 1)}
                    disabled={slice.page <= 1}
                    aria-label="Previous page"
                    aria-describedby={prevPreview ? `${previewBaseId}-prev` : undefined}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  {prevPreview ? (
                    <span role="tooltip" id={`${previewBaseId}-prev`} className={styles.pagePreview}>
                      <strong>Previous page</strong>
                      <span>{prevPreview.headline}</span>
                      <span>{prevPreview.breakdown}</span>
                    </span>
                  ) : null}
                </span>

                <span className={styles.pageIndicator} aria-live="polite">
                  Page {slice.page} of {slice.totalPages}
                </span>

                <span className={styles.pageButtonWrap}>
                  <button
                    type="button"
                    className={styles.pageButton}
                    onClick={() => setPage(slice.page + 1)}
                    disabled={slice.page >= slice.totalPages}
                    aria-label="Next page"
                    aria-describedby={nextPreview ? `${previewBaseId}-next` : undefined}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                  {nextPreview ? (
                    <span role="tooltip" id={`${previewBaseId}-next`} className={styles.pagePreview}>
                      <strong>Next page</strong>
                      <span>{nextPreview.headline}</span>
                      <span>{nextPreview.breakdown}</span>
                    </span>
                  ) : null}
                </span>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
