"use client";

// The sequence list that lives below the summary cards: a compact control bar
// (count | search | Status dropdown | Email accounts dropdown) and a table of
// 5 rows per page. Each row shows name, recipients + sender, status, current
// state, created date, progress, and mini performance metrics. Deeper
// analysis lives on the detail page.

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  MailCheck,
  Reply,
  Search
} from "lucide-react";

import { CampaignCardActions } from "@/components/campaign-card-actions";
import { formatRelativeTime } from "@/components/dashboard/formatters";
import {
  ALL_SENDER_ACCOUNTS,
  SEQUENCE_FILTERS,
  SEQUENCE_TONE_LABELS,
  collectSequenceSenderEmails,
  countSequenceFilters,
  describeSequenceState,
  filterSequenceItems,
  getSequenceOpenRatePercent,
  paginateSequenceItems,
  primarySequenceTone,
  type SequenceFilterId,
  type SequenceListItem
} from "@/lib/sequence-dashboard";
import {
  buildSequenceDashboardReturnTo,
  buildSequenceDetailHref,
  normalizeSequenceDashboardSearchParams,
  readSequenceDashboardUrlState,
  updateSequenceDashboardSearchParams,
  type SequenceDashboardUrlState
} from "@/lib/sequence-dashboard-url";
import styles from "./sequence-dashboard.module.css";

const countFormatter = new Intl.NumberFormat("en-US");
const SEQUENCE_SEARCH_DEBOUNCE_MS = 200;

function formatCount(value: number) {
  return countFormatter.format(value);
}

type ToolbarSelectOption = {
  value: string;
  label: string;
  count?: number;
  tone?: string;
};

// Custom single-select dropdown for the control bar — never the browser
// default select element. Listbox pattern with roving focus: the trigger
// announces the current selection, options are real buttons, Arrow/Home/End
// move focus, Escape closes and returns focus to the trigger.
function ToolbarSelect({
  label,
  placeholder,
  value,
  options,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  options: ToolbarSelectOption[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? options[0];
  const isNeutral = selected.value === options[0].value;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    // Move focus to the current selection so arrow keys start from it.
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
      list?.querySelector<HTMLButtonElement>("button");
    target?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function select(next: string) {
    onChange(next);
    closeAndRefocus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = listRef.current;
    if (!list) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRefocus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[Math.max(index - 1, 0)]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }

  return (
    <div ref={rootRef} className={styles.select}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.selectTrigger}
        data-active={isNeutral ? undefined : "true"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${selected.label}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        {selected.tone && !isNeutral ? (
          <span className={styles.selectDot} data-tone={selected.tone} aria-hidden="true" />
        ) : null}
        <span className={styles.selectValue}>{isNeutral ? placeholder : selected.label}</span>
        <ChevronDown aria-hidden="true" className={styles.selectChevron} />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={styles.selectMenu}
          onKeyDown={onListKeyDown}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === selected.value}
              className={styles.selectOption}
              onClick={() => select(option.value)}
            >
              {option.tone ? (
                <span className={styles.selectDot} data-tone={option.tone} aria-hidden="true" />
              ) : null}
              <span className={styles.optionLabel} title={option.label}>
                {option.label}
              </span>
              {typeof option.count === "number" ? (
                <span className={styles.optionCount}>{formatCount(option.count)}</span>
              ) : null}
              {option.value === selected.value ? (
                <Check aria-hidden="true" className={styles.optionCheck} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SequenceRow({ item, returnTo }: { item: SequenceListItem; returnTo: string }) {
  const tone = primarySequenceTone(item);
  const openRate = getSequenceOpenRatePercent(item);
  const createdDate = new Date(item.createdAtIso);
  const detailHref = buildSequenceDetailHref(item.id, returnTo);

  return (
    <li className={styles.row} data-tone={tone}>
      <Link
        href={detailHref}
        className={styles.rowLink}
        aria-label={`Open sequence ${item.name}`}
      >
        <span className={styles.rowIdentity}>
          <span className={styles.rowDot} data-tone={tone} aria-hidden="true" />
          <span className={styles.rowTitleBlock}>
            <span className={styles.rowName} title={item.name}>
              {item.name}
            </span>
            <span className={styles.rowMeta} title={`Contact list: ${item.listName}`}>
              {formatCount(item.enrolledCount)} recipient{item.enrolledCount === 1 ? "" : "s"} ·{" "}
              {item.senderEmail}
            </span>
          </span>
        </span>

        <span className={styles.rowStatus} data-tone={tone}>
          {SEQUENCE_TONE_LABELS[tone]}
        </span>

        <span className={styles.rowState}>{describeSequenceState(item)}</span>

        <span
          className={styles.rowCreated}
          title={createdDate.toLocaleString()}
          suppressHydrationWarning
        >
          {formatRelativeTime(createdDate)}
        </span>

        <span className={styles.rowProgress}>
          <span className={styles.rowProgressValue}>{item.progressPercent}%</span>
          <span className={styles.rowTrack} aria-hidden="true">
            <span className={styles.rowTrackFill} style={{ width: `${item.progressPercent}%` }} />
          </span>
        </span>

        <span className={styles.rowPerformance}>
          <span
            className={styles.rowStat}
            data-tooltip="Delivered emails"
            aria-label={`Delivered emails: ${formatCount(item.deliveredCount)}`}
            tabIndex={0}
          >
            <MailCheck aria-hidden="true" />
            {formatCount(item.deliveredCount)}
          </span>
          <span
            className={styles.rowStat}
            data-tooltip="Open rate"
            aria-label={`Open rate: ${openRate === null ? "unavailable" : `${openRate}%`}`}
            tabIndex={0}
          >
            <Eye aria-hidden="true" />
            {openRate === null ? "—" : `${openRate}%`}
          </span>
          <span
            className={styles.rowStat}
            data-tooltip="Replies received"
            aria-label={`Replies received: ${formatCount(item.repliedCount)}`}
            tabIndex={0}
          >
            <Reply aria-hidden="true" />
            {formatCount(item.repliedCount)}
          </span>
        </span>
      </Link>

      <span className={styles.rowActions}>
        <CampaignCardActions
          campaignId={item.id}
          campaignName={item.name}
          detailHref={detailHref}
        />
      </span>
    </li>
  );
}

export function SequenceDashboard({ items }: { items: SequenceListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const counts = useMemo(() => countSequenceFilters(items), [items]);
  const senderEmails = useMemo(() => collectSequenceSenderEmails(items), [items]);
  const urlState = useMemo(
    () => readSequenceDashboardUrlState(searchParams, senderEmails),
    [searchParams, senderEmails]
  );
  const { filter, sender, query, page: urlPage } = urlState;
  const [searchQuery, setSearchQuery] = useState(query);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const committedSearchQueryRef = useRef(query);
  const [page, setPage] = useState(urlPage);
  const [listMinHeight, setListMinHeight] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const filtered = useMemo(
    () => filterSequenceItems(items, filter, deferredSearchQuery, sender),
    [items, filter, deferredSearchQuery, sender]
  );
  const slice = paginateSequenceItems(filtered, page);
  const normalizedSearchParams = useMemo(
    () => normalizeSequenceDashboardSearchParams(searchParams, urlState, slice.page),
    [searchParams, slice.page, urlState]
  );
  const normalizedSearch = normalizedSearchParams.toString();
  const returnTo = buildSequenceDashboardReturnTo(pathname, normalizedSearchParams);

  const replaceUrlState = useCallback(
    (patch: Partial<SequenceDashboardUrlState>) => {
      const nextParams = updateSequenceDashboardSearchParams(searchParams, patch);
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(href as Route, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const replacePaginationPage = useCallback(
    (nextPage: number) => {
      const currentHeight = listRef.current?.getBoundingClientRect().height ?? 0;
      if (currentHeight > 0) {
        setListMinHeight((height) => Math.max(height ?? 0, currentHeight));
      }

      setPage(nextPage);

      const currentParams = new URLSearchParams(window.location.search);
      const nextParams = updateSequenceDashboardSearchParams(currentParams, { page: nextPage });
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      window.history.replaceState(window.history.state, "", href);
    },
    [pathname]
  );

  const replaceSearchQuery = useCallback(
    (nextQuery: string) => {
      const currentParams = new URLSearchParams(window.location.search);
      const nextParams = updateSequenceDashboardSearchParams(currentParams, {
        query: nextQuery,
        page: 1
      });
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      window.history.replaceState(window.history.state, "", href);
    },
    [pathname]
  );

  useEffect(() => {
    setPage(urlPage);
  }, [urlPage]);

  useEffect(() => {
    if (query === committedSearchQueryRef.current) {
      return;
    }

    committedSearchQueryRef.current = query;
    setSearchQuery(query);
  }, [query]);

  useEffect(() => {
    if (searchQuery === query) {
      return;
    }

    const timeout = window.setTimeout(() => {
      committedSearchQueryRef.current = searchQuery;
      replaceSearchQuery(searchQuery);
    }, SEQUENCE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [query, replaceSearchQuery, searchQuery]);

  useEffect(() => {
    if (searchQuery !== query) {
      return;
    }

    const browserSearch = new URLSearchParams(window.location.search).toString();
    if (normalizedSearch === browserSearch) {
      return;
    }

    const href = normalizedSearch ? `${pathname}?${normalizedSearch}` : pathname;
    router.replace(href as Route, { scroll: false });
  }, [normalizedSearch, pathname, query, router, searchQuery]);

  // Draft is only offered when draft sequences exist; the six core statuses
  // always appear in the dropdown, including zero counts.
  const statusOptions: ToolbarSelectOption[] = SEQUENCE_FILTERS.filter(
    (entry) => entry.id !== "draft" || counts.draft > 0
  ).map((entry) => ({
    value: entry.id,
    label: entry.label,
    count: counts[entry.id],
    tone: entry.id
  }));

  const senderOptions: ToolbarSelectOption[] = [
    { value: ALL_SENDER_ACCOUNTS, label: "All email accounts" },
    ...senderEmails.map((email) => ({ value: email, label: email }))
  ];

  function selectFilter(next: string) {
    committedSearchQueryRef.current = searchQuery;
    setPage(1);
    setListMinHeight(null);
    replaceUrlState({ filter: next as SequenceFilterId, query: searchQuery, page: 1 });
  }

  function selectSender(next: string) {
    committedSearchQueryRef.current = searchQuery;
    setPage(1);
    setListMinHeight(null);
    replaceUrlState({ sender: next, query: searchQuery, page: 1 });
  }

  function onSearchChange(value: string) {
    setSearchQuery(value);
    setPage(1);
    setListMinHeight(null);
  }

  function clearFilters() {
    setSearchQuery("");
    setPage(1);
    setListMinHeight(null);
    replaceUrlState({
      filter: "all",
      sender: ALL_SENDER_ACCOUNTS,
      query: "",
      page: 1
    });
  }

  const hasSequences = items.length > 0;
  const hasResults = filtered.length > 0;

  return (
    <section className={styles.dashboard} aria-label="Sequence list">
      <div className={styles.toolbar}>
        <span className={styles.totalCount}>
          {formatCount(counts.all)} sequence{counts.all === 1 ? "" : "s"}
        </span>

        <div className={styles.search}>
          <Search aria-hidden="true" className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search a sequence…"
            aria-label="Search sequences by name, list, template, or sender"
          />
        </div>

        <div className={styles.filterControls} role="group" aria-label="Sequence filters">
          <ToolbarSelect
            label="Filter sequences by status"
            placeholder="Status"
            value={filter}
            options={statusOptions}
            onChange={selectFilter}
          />
          <ToolbarSelect
            label="Filter sequences by email account"
            placeholder="Email accounts"
            value={sender}
            options={senderOptions}
            onChange={selectSender}
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
            <Link className="button" href="/campaigns/new">
              Create sequence
            </Link>
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
          <p className={styles.emptyCopy}>Try another status, email account, or search.</p>
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

          <div className={styles.tableHead} aria-hidden="true">
            <span>Name</span>
            <span>Status</span>
            <span>Current state</span>
            <span>Created</span>
            <span>Progress</span>
            <span>Performance</span>
            <span className={styles.tableHeadActions}>Actions</span>
          </div>

          <ul
            ref={listRef}
            className={styles.list}
            style={listMinHeight ? { minHeight: listMinHeight } : undefined}
          >
            {slice.pageItems.map((item) => (
              <SequenceRow key={item.id} item={item} returnTo={returnTo} />
            ))}
          </ul>

          {slice.totalPages > 1 ? (
            <nav className={styles.pagination} aria-label="Sequences pages">
              <span className={styles.paginationHint}>{slice.rangeLabel}</span>
              <div className={styles.paginationControls}>
                <button
                  type="button"
                  className={styles.pageButton}
                  onClick={() => replacePaginationPage(slice.page - 1)}
                  disabled={slice.page <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft aria-hidden="true" />
                </button>

                <span className={styles.pageIndicator} aria-live="polite">
                  Page {slice.page} of {slice.totalPages}
                </span>

                <button
                  type="button"
                  className={styles.pageButton}
                  onClick={() => replacePaginationPage(slice.page + 1)}
                  disabled={slice.page >= slice.totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
