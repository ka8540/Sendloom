"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Mail,
  Search,
  SendHorizontal,
  ShieldCheck,
  Users,
  X
} from "lucide-react";

import { CampaignCardActions } from "@/components/campaign-card-actions";
import { CampaignPauseResumeButton } from "@/components/campaign-pause-resume-button";
import { LocalDateTime } from "@/components/local-date-time";
import {
  countSequencesByFilter,
  filterSequences,
  getSequencePagination,
  primarySequenceTone,
  resolveSequenceSelection,
  SEQUENCE_PAGE_SIZE,
  summarizeSequencePage,
  type SequenceFilterKey,
  type SequenceStatusFlags,
  type SequenceToneKey
} from "./sequence-insights";
import styles from "./command-center.module.css";

// Serializable card payload shaped on the server (page.tsx) from real
// Campaign/CampaignRun/RecipientJob data. No field here is invented — every
// number traces back to prisma rows.
export type SequenceBoardItem = {
  id: string;
  name: string;
  statusLabel: string;
  flags: SequenceStatusFlags;
  listName: string;
  templateName: string;
  senderName: string;
  senderEmail: string;
  scheduleLabel: string;
  scheduleDetail: string;
  enrolled: number;
  totalRecipients: number;
  delivered: number;
  opened: number;
  skipped: number;
  issues: number;
  pendingCount: number;
  healthPercent: number | null;
  openedPercent: number | null;
  metricsKnown: boolean;
  isFromPreviousRun: boolean;
  latestRunStatusLabel: string | null;
  latestRunAt: string | null;
  validatedAt: string | null;
  isPaused: boolean;
  canPause: boolean;
};

const FILTER_LABELS: Array<{ key: SequenceFilterKey; label: string; hideWhenEmpty?: boolean }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "attention", label: "Needs attention" },
  { key: "completed", label: "Completed" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Draft", hideWhenEmpty: true }
];

const countFormatter = new Intl.NumberFormat("en-US");

function formatCount(value: number) {
  return countFormatter.format(value);
}

function DeliveryRail({ item, compact }: { item: SequenceBoardItem; compact?: boolean }) {
  const total = item.totalRecipients;
  const known = item.metricsKnown && total > 0;
  const width = (value: number) => `${known ? Math.max(0, Math.min(100, (value / total) * 100)) : 0}%`;

  return (
    <div
      className={`${styles.rail} ${compact ? styles.railCompact : ""}`}
      role="img"
      aria-label={
        known
          ? `Delivery: ${formatCount(item.delivered)} delivered, ${formatCount(item.skipped)} skipped, ${formatCount(item.issues)} issues, ${formatCount(item.pendingCount)} pending of ${formatCount(total)}`
          : "No delivery activity yet"
      }
    >
      <span className={styles.railDelivered} style={{ width: width(item.delivered) }} />
      <span className={styles.railSkipped} style={{ width: width(item.skipped) }} />
      <span className={styles.railIssues} style={{ width: width(item.issues) }} />
    </div>
  );
}

function HealthRing({ item }: { item: SequenceBoardItem }) {
  const percent = item.healthPercent;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : (percent / 100) * circumference;

  return (
    <div className={styles.ringWrap}>
      <svg
        viewBox="0 0 120 120"
        className={styles.ring}
        role="img"
        aria-label={percent === null ? "Delivery health not available yet" : `Delivery health ${percent} percent`}
      >
        <circle className={styles.ringTrack} cx="60" cy="60" r={radius} />
        <circle
          className={styles.ringValue}
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className={styles.ringCenter} aria-hidden="true">
        <strong>{percent === null ? "—" : `${percent}%`}</strong>
        <span>health</span>
      </div>
    </div>
  );
}

function InspectorFact({
  label,
  value,
  detail
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <strong className={styles.factValue}>{value}</strong>
      {detail ? <small className={styles.factDetail}>{detail}</small> : null}
    </div>
  );
}

function SequenceInspector({ item, inline }: { item: SequenceBoardItem; inline?: boolean }) {
  const tone = primarySequenceTone(item);

  return (
    <div className={`${styles.inspector} ${inline ? styles.inspectorInline : ""}`} data-tone={tone}>
      <div className={styles.inspectorHead}>
        <div className={styles.inspectorHeading}>
          <span className={styles.inspectorKicker}>Inspector</span>
          <h3 className={styles.inspectorTitle} title={item.name}>
            {item.name}
          </h3>
        </div>
        <span className={styles.statusPill} data-tone={tone}>
          {item.statusLabel}
        </span>
      </div>

      <div className={styles.inspectorPulse}>
        <HealthRing item={item} />
        <div className={styles.legend}>
          <div className={styles.legendRow} data-tone="delivered">
            <span className={styles.legendDot} aria-hidden="true" />
            <span className={styles.legendLabel}>Delivered</span>
            <strong>{item.metricsKnown ? formatCount(item.delivered) : "—"}</strong>
          </div>
          <div className={styles.legendRow} data-tone="skipped">
            <span className={styles.legendDot} aria-hidden="true" />
            <span className={styles.legendLabel}>Skipped</span>
            <strong>{item.metricsKnown ? formatCount(item.skipped) : "—"}</strong>
          </div>
          <div className={styles.legendRow} data-tone="issues">
            <span className={styles.legendDot} aria-hidden="true" />
            <span className={styles.legendLabel}>Issues</span>
            <strong>{item.metricsKnown ? formatCount(item.issues) : "—"}</strong>
          </div>
          <div className={styles.legendRow} data-tone="pending">
            <span className={styles.legendDot} aria-hidden="true" />
            <span className={styles.legendLabel}>Pending</span>
            <strong>{item.metricsKnown ? formatCount(item.pendingCount) : "—"}</strong>
          </div>
        </div>
      </div>

      <DeliveryRail item={item} />
      {item.isFromPreviousRun ? (
        <p className={styles.inspectorNote}>Showing the last completed run — the next run is queued.</p>
      ) : null}

      <div className={styles.factGrid}>
        <InspectorFact label="Enrolled" value={formatCount(item.enrolled)} detail="Recipients" />
        <InspectorFact
          label="Opened"
          value={item.openedPercent === null ? "—" : `${item.openedPercent}%`}
          detail={item.metricsKnown ? `${formatCount(item.opened)} opens` : "Waiting for activity"}
        />
        <InspectorFact
          label="Latest run"
          value={item.latestRunStatusLabel ?? "Waiting to launch"}
          detail={
            item.latestRunAt ? <LocalDateTime value={item.latestRunAt} /> : "No delivery activity yet"
          }
        />
        <InspectorFact
          label="Validation"
          value={item.validatedAt ? "Validated" : "Needs validation"}
          detail={item.validatedAt ? <LocalDateTime value={item.validatedAt} /> : "Before next send"}
        />
        <InspectorFact label="Send timing" value={item.scheduleLabel} detail={item.scheduleDetail} />
        <InspectorFact label="Sender" value={item.senderName} detail={item.senderEmail} />
        <InspectorFact label="Template" value={item.templateName} />
        <InspectorFact label="Contact list" value={item.listName} />
      </div>

      {item.issues > 0 ? (
        <div className={styles.attentionNote}>
          <span aria-hidden="true">!</span>
          {formatCount(item.issues)} {item.issues === 1 ? "send needs" : "sends need"} attention — open the
          sequence to review and retry.
        </div>
      ) : null}

      <Link className={styles.inspectorOpen} href={`/campaigns/${item.id}`}>
        Open sequence
        <ArrowUpRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function PagePreview({
  direction,
  count,
  summary,
  id
}: {
  direction: "prev" | "next";
  count: number;
  summary: string;
  id: string;
}) {
  return (
    <div className={styles.pagePreview} role="tooltip" id={id}>
      <strong>{direction === "next" ? "Next page" : "Previous page"}</strong>
      <span>
        {count} sequence{count === 1 ? "" : "s"}
      </span>
      {summary ? <span className={styles.pagePreviewSummary}>{summary}</span> : null}
    </div>
  );
}

export function SequencesCommandCenter({ items }: { items: SequenceBoardItem[] }) {
  const [filter, setFilter] = useState<SequenceFilterKey>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewDirection, setPreviewDirection] = useState<"prev" | "next" | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());

  const counts = useMemo(() => countSequencesByFilter(items), [items]);
  const filtered = useMemo(() => filterSequences(items, filter, query), [items, filter, query]);
  const pagination = getSequencePagination(filtered.length, page);
  const visible = filtered.slice(pagination.start, pagination.end);
  const selection = resolveSequenceSelection(
    visible.map((item) => item.id),
    selectedId
  );
  const selectedItem = visible.find((item) => item.id === selection) ?? null;

  const previewPage = previewDirection === "next" ? pagination.page + 1 : pagination.page - 1;
  const previewItems =
    previewDirection && previewPage >= 1 && previewPage <= pagination.totalPages
      ? filtered.slice((previewPage - 1) * SEQUENCE_PAGE_SIZE, previewPage * SEQUENCE_PAGE_SIZE)
      : [];
  const previewSummary = summarizeSequencePage(previewItems);

  function changeFilter(next: SequenceFilterKey) {
    setFilter(next);
    setPage(1);
  }

  function changeQuery(next: string) {
    setQuery(next);
    setPage(1);
  }

  function clearFilters() {
    setFilter("all");
    setQuery("");
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), pagination.totalPages));
    setPreviewDirection(null);
  }

  function moveSelection(fromId: string, offset: number) {
    const index = visible.findIndex((item) => item.id === fromId);
    const target = visible[index + offset];
    if (!target) {
      return;
    }
    setSelectedId(target.id);
    cardRefs.current.get(target.id)?.focus();
  }

  const hasSequences = items.length > 0;
  const hasMatches = filtered.length > 0;
  const showPagination = pagination.totalPages > 1;

  if (!hasSequences) {
    return (
      <section className={styles.board} aria-label="Sequences">
        <div className={styles.emptyBoard}>
          <div className={styles.emptyIcon} aria-hidden="true">
            <SendHorizontal />
          </div>
          <h2>No sequences yet</h2>
          <p>Import a list, create a template, then launch your first sequence.</p>
          <div className={styles.emptyActions}>
            <a className="button" href="#create-sequence">
              Create sequence
            </a>
            <Link className="button secondary" href="/imports">
              Import list
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.board} aria-label="Sequences">
      <div className={styles.commandBar}>
        <div className={styles.filterRail} role="group" aria-label="Filter sequences by status">
          {FILTER_LABELS.filter((entry) => !(entry.hideWhenEmpty && counts[entry.key] === 0)).map(
            (entry) => (
              <button
                key={entry.key}
                type="button"
                className={styles.filterPill}
                data-tone={entry.key}
                aria-pressed={filter === entry.key}
                onClick={() => changeFilter(entry.key)}
              >
                <span className={styles.filterDot} aria-hidden="true" />
                <span className={styles.filterLabel}>{entry.label}</span>
                <span className={styles.filterCount}>{formatCount(counts[entry.key])}</span>
              </button>
            )
          )}
        </div>

        <div className={styles.searchField}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <label htmlFor="sequence-search" className={styles.srOnly}>
            Search sequences by name, list, template, or sender
          </label>
          <input
            id="sequence-search"
            type="search"
            className={styles.searchInput}
            placeholder="Search sequences…"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => changeQuery("")}
              aria-label="Clear search"
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <p className={styles.rangeLine} aria-live="polite">
        {pagination.rangeLabel}
        {filter !== "all" || query.trim() ? " (filtered)" : ""}
      </p>

      {hasMatches ? (
        <div className={styles.boardGrid}>
          <div className={styles.queue}>
            {visible.map((item) => {
              const tone = primarySequenceTone(item);
              const isSelected = item.id === selection;

              return (
                <div key={item.id} className={styles.cardSlot}>
                  <article
                    className={styles.card}
                    data-selected={isSelected ? "true" : undefined}
                    data-tone={tone}
                  >
                    <button
                      type="button"
                      className={styles.cardSelect}
                      aria-pressed={isSelected}
                      aria-label={`Inspect sequence ${item.name}, status ${item.statusLabel}`}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveSelection(item.id, 1);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveSelection(item.id, -1);
                        }
                      }}
                      ref={(node) => {
                        if (node) {
                          cardRefs.current.set(item.id, node);
                        } else {
                          cardRefs.current.delete(item.id);
                        }
                      }}
                    >
                      <span className={styles.cardTopRow}>
                        <span className={styles.cardDot} data-tone={tone} aria-hidden="true" />
                        <span className={styles.cardName} title={item.name}>
                          {item.name}
                        </span>
                        <span className={styles.statusPill} data-tone={tone}>
                          {item.statusLabel}
                        </span>
                      </span>

                      <span className={styles.cardChips}>
                        <span className={styles.cardChip} title={item.listName}>
                          <Users aria-hidden="true" />
                          <span>{item.listName}</span>
                        </span>
                        <span className={styles.cardChip} title={`${item.senderName} <${item.senderEmail}>`}>
                          <Mail aria-hidden="true" />
                          <span>{item.senderName}</span>
                        </span>
                      </span>

                      <span className={styles.cardMetrics}>
                        <DeliveryRail item={item} compact />
                        <span className={styles.cardNumbers}>
                          <strong>{item.healthPercent === null ? "—" : `${item.healthPercent}%`}</strong>
                          <span className={styles.cardNumbersDivider} aria-hidden="true" />
                          <span>{formatCount(item.enrolled)} enrolled</span>
                          {item.issues > 0 ? (
                            <span className={styles.issueChip}>
                              {formatCount(item.issues)} issue{item.issues === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>

                    <div className={styles.cardActions}>
                      {item.canPause || item.isPaused ? (
                        <CampaignPauseResumeButton
                          campaignId={item.id}
                          isPaused={item.isPaused}
                          label={item.isPaused ? "Resume" : "Pause"}
                          className={styles.pauseChip}
                        />
                      ) : null}
                      <CampaignCardActions campaignId={item.id} campaignName={item.name} />
                    </div>
                  </article>

                  {isSelected && selectedItem ? (
                    <div className={styles.inlineInspector}>
                      <SequenceInspector item={selectedItem} inline />
                    </div>
                  ) : null}
                </div>
              );
            })}

            {showPagination ? (
              <div className={styles.paginationBar}>
                <div className={styles.paginationControls}>
                  {previewDirection && previewItems.length > 0 ? (
                    <PagePreview
                      direction={previewDirection}
                      count={previewItems.length}
                      summary={previewSummary}
                      id="sequence-page-preview"
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.paginationButton}
                    onClick={() => goToPage(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    aria-label="Previous sequences page"
                    aria-describedby={previewDirection === "prev" ? "sequence-page-preview" : undefined}
                    onMouseEnter={() => setPreviewDirection(pagination.page > 1 ? "prev" : null)}
                    onMouseLeave={() => setPreviewDirection(null)}
                    onFocus={() => setPreviewDirection(pagination.page > 1 ? "prev" : null)}
                    onBlur={() => setPreviewDirection(null)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <span className={styles.paginationPage}>
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className={styles.paginationButton}
                    onClick={() => goToPage(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    aria-label="Next sequences page"
                    aria-describedby={previewDirection === "next" ? "sequence-page-preview" : undefined}
                    onMouseEnter={() =>
                      setPreviewDirection(pagination.page < pagination.totalPages ? "next" : null)
                    }
                    onMouseLeave={() => setPreviewDirection(null)}
                    onFocus={() =>
                      setPreviewDirection(pagination.page < pagination.totalPages ? "next" : null)
                    }
                    onBlur={() => setPreviewDirection(null)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <aside className={styles.inspectorColumn} aria-label="Sequence details">
            {selectedItem ? (
              <SequenceInspector item={selectedItem} />
            ) : (
              <div className={styles.inspectorPlaceholder}>
                <ShieldCheck aria-hidden="true" />
                <p>Select a sequence to inspect its delivery details.</p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className={styles.emptyFiltered}>
          <div className={styles.emptyIcon} aria-hidden="true">
            <Inbox />
          </div>
          <h3>No sequences match</h3>
          <p>
            Nothing matches
            {query.trim() ? <> “{query.trim()}”</> : null}
            {filter !== "all" ? " under this status filter" : ""}. Try a different search or clear the
            filters.
          </p>
          <button type="button" className="button secondary" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

    </section>
  );
}
