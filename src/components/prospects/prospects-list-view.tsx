"use client";

// Discover LIST page (/prospects). Shows only the Discover header, daily quota,
// Refresh, New search, the empty state, and the Search History table. Selecting
// a row navigates to the dedicated detail page (/prospects/[searchId]); this page
// never renders company details, the People table, or selection/export actions.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, Users } from "lucide-react";

import { CircularCloseButton } from "@/components/circular-close-button";
import {
  CREATE_SEARCH_MUTATION,
  DELETE_SEARCH_MUTATION,
  DISCOVER_QUOTA_QUERY,
  PROSPECT_SEARCHES_QUERY,
  SEARCHES_PAGE_SIZE,
  buildSearchesVariables,
  prospectGraphql,
  type Connection,
  type DiscoverQuota,
  type ProspectSearchNode
} from "@/components/prospects/prospect-graphql";
import {
  PROSPECT_FINDER_SUBTITLE,
  PROSPECT_FINDER_TAGLINE,
  PROSPECT_FINDER_TITLE,
  discoverPerSearchSentence,
  formatDateTime,
  formatPageLabel,
  formatQuotaRemaining,
  formatQuotaReset,
  formatShowingLabel,
  resolveHistoryPageAfterDelete,
  resolvePageCount,
  resolveProspectPageState,
  statusBadge
} from "@/components/prospects/prospect-view";
import {
  BadgePill,
  DisabledState,
  EmptyState,
  QuotaIndicator,
  EMPTY_FORM,
  type ActionNotice,
  type CreateForm
} from "@/components/prospects/prospects-shared";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/prospects/prospects-dashboard.module.css";

export function ProspectsListView({ featureEnabled }: { featureEnabled: boolean }) {
  const router = useRouter();
  const [disabled, setDisabled] = useState(!featureEnabled);

  const [searches, setSearches] = useState<ProspectSearchNode[]>([]);
  const [searchesLoading, setSearchesLoading] = useState(true);
  const [searchesError, setSearchesError] = useState<string | null>(null);
  const [searchesHasNext, setSearchesHasNext] = useState(false);
  const [searchesEndCursor, setSearchesEndCursor] = useState<string | null>(null);
  const [searchesTotal, setSearchesTotal] = useState(0);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const historyAfterCursors = useRef<(string | null)[]>([null]);
  const searchesReq = useRef(0);

  const [quota, setQuota] = useState<DiscoverQuota | null>(null);
  const [showNewSearch, setShowNewSearch] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  // In-app delete confirmation state (replaces the old native browser confirm).
  const [searchPendingDeletion, setSearchPendingDeletion] = useState<ProspectSearchNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const pageState = resolveProspectPageState({ disabled, loading: searchesLoading, searchCount: searchesTotal });

  // Contextual onboarding (shared manual/help system). The list page drives its
  // own stage (starter when empty, list when populated).
  const { manual: discoverManual, isOpen: manualOpen, openManualStage, isStageComplete } = useManual();
  const autoTourStagesRef = useRef<Set<string>>(new Set());

  const loadQuota = useCallback(async () => {
    const result = await prospectGraphql<{ discoverQuota: DiscoverQuota }>(DISCOVER_QUOTA_QUERY);
    if (result.disabled) {
      setDisabled(true);
      return;
    }
    if (result.data?.discoverQuota) {
      setQuota(result.data.discoverQuota);
    }
  }, []);

  const loadSearches = useCallback(async (options: { pageIndex?: number; after?: string | null } = {}) => {
    const pageIndex = options.pageIndex ?? 0;
    const after = options.after ?? null;
    const req = ++searchesReq.current;
    setSearchesLoading(true);
    setSearchesError(null);
    const result = await prospectGraphql<{ prospectSearches: Connection<ProspectSearchNode> }>(
      PROSPECT_SEARCHES_QUERY,
      buildSearchesVariables({ after })
    );
    if (req !== searchesReq.current) {
      return;
    }
    if (result.disabled) {
      setDisabled(true);
      setSearchesLoading(false);
      return;
    }
    setDisabled(false);
    if (result.error || !result.data) {
      setSearchesError(result.error ?? "Could not load searches.");
      setSearchesLoading(false);
      return;
    }
    const connection = result.data.prospectSearches;
    setSearches(connection.edges.map((edge) => edge.node));
    setSearchesHasNext(connection.pageInfo.hasNextPage);
    setSearchesEndCursor(connection.pageInfo.endCursor);
    setSearchesTotal(connection.totalCount);
    setHistoryPageIndex(pageIndex);
    setSearchesLoading(false);
  }, []);

  const handleHistoryNext = useCallback(() => {
    if (!searchesHasNext || searchesLoading) {
      return;
    }
    const after = searchesEndCursor;
    historyAfterCursors.current[historyPageIndex + 1] = after;
    void loadSearches({ pageIndex: historyPageIndex + 1, after });
  }, [historyPageIndex, loadSearches, searchesEndCursor, searchesHasNext, searchesLoading]);

  const handleHistoryPrev = useCallback(() => {
    if (historyPageIndex === 0 || searchesLoading) {
      return;
    }
    const after = historyAfterCursors.current[historyPageIndex - 1] ?? null;
    void loadSearches({ pageIndex: historyPageIndex - 1, after });
  }, [historyPageIndex, loadSearches, searchesLoading]);

  const refreshAll = useCallback(() => {
    setActionError(null);
    setActionNotice(null);
    void loadSearches({ pageIndex: historyPageIndex, after: historyAfterCursors.current[historyPageIndex] ?? null });
    void loadQuota();
  }, [historyPageIndex, loadQuota, loadSearches]);

  // Open the in-app delete confirmation for a row. Never deletes here and never
  // navigates to the detail page; it just records which search is pending (and the
  // trigger button so focus can return to it on cancel).
  const handleRequestDelete = useCallback((search: ProspectSearchNode, trigger: HTMLButtonElement | null) => {
    deleteTriggerRef.current = trigger;
    setDeleteError(null);
    setSearchPendingDeletion(search);
  }, []);

  const handleCancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setSearchPendingDeletion(null);
    setDeleteError(null);
    // Return focus to the trash icon that opened the dialog.
    deleteTriggerRef.current?.focus();
  }, [deleting]);

  // Runs ONLY when the user confirms in the dialog. Reuses the shared GraphQL
  // client (same CSRF/auth as every Discover mutation). The row + count update and
  // the success toast appear only after the backend confirms; on failure the dialog
  // stays open with a safe message and the row is preserved.
  const handleConfirmDelete = useCallback(async () => {
    const search = searchPendingDeletion;
    if (!search || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const result = await prospectGraphql<{ deleteProspectSearch: boolean }>(DELETE_SEARCH_MUTATION, {
      id: search.id
    });
    if (result.disabled) {
      setDeleting(false);
      setSearchPendingDeletion(null);
      setDisabled(true);
      return;
    }
    if (result.error || !result.data?.deleteProspectSearch) {
      // Keep the dialog open with a safe product message — never a raw backend error.
      setDeleting(false);
      setDeleteError("This search could not be deleted. Please try again.");
      return;
    }
    // Success: remove the row + update the count, then surface the toast.
    const remaining = searches.filter((item) => item.id !== search.id);
    setSearches(remaining);
    setSearchesTotal((total) => Math.max(0, total - 1));
    setDeleting(false);
    setSearchPendingDeletion(null);
    setActionError(null);
    setActionNotice({ message: "Search deleted." });
    // Pagination edge: if that emptied a page beyond the first, step back.
    const next = resolveHistoryPageAfterDelete({ remainingOnPage: remaining.length, pageIndex: historyPageIndex });
    if (next.goToPreviousPage) {
      void loadSearches({
        pageIndex: next.pageIndex,
        after: historyAfterCursors.current[next.pageIndex] ?? null
      });
    }
  }, [deleting, historyPageIndex, loadSearches, searches, searchPendingDeletion]);

  const handleCreate = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const jobTitles = form.jobTitles.split(",").map((value) => value.trim()).filter(Boolean);
      const locations = form.locations.split(",").map((value) => value.trim()).filter(Boolean);
      if (!form.companyName.trim() || jobTitles.length === 0) {
        setActionError("Enter a company name and at least one job title.");
        return;
      }
      setCreating(true);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ createProspectSearch: { id: string } }>(CREATE_SEARCH_MUTATION, {
        input: { companyName: form.companyName.trim(), jobTitles, locations }
      });
      setCreating(false);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Could not create the search.");
        return;
      }
      // Open the new draft's detail page so the user can process it there.
      setForm(EMPTY_FORM);
      setShowNewSearch(false);
      router.push(`/prospects/${result.data.createProspectSearch.id}` as Route);
    },
    [form, router]
  );

  useEffect(() => {
    void loadSearches();
    void loadQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open the list guide once per stage for a first-time user.
  useEffect(() => {
    if (!discoverManual || manualOpen || showNewSearch) {
      return;
    }
    let stage: "starter" | "list" | null = null;
    if (pageState === "empty") {
      stage = "starter";
    } else if (pageState === "ready") {
      stage = "list";
    }
    if (!stage || autoTourStagesRef.current.has(stage)) {
      return;
    }
    autoTourStagesRef.current.add(stage);
    if (isStageComplete(stage)) {
      return;
    }
    openManualStage(stage);
  }, [discoverManual, manualOpen, showNewSearch, pageState, openManualStage, isStageComplete]);

  const historyPageCount = resolvePageCount(searchesTotal, SEARCHES_PAGE_SIZE);
  const historyOffset = historyPageIndex * SEARCHES_PAGE_SIZE;

  return (
    <div className={styles.page}>
      <header className={styles.header} data-discover-tour="page-intro">
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>
            <Users aria-hidden="true" /> {PROSPECT_FINDER_TAGLINE}
          </p>
          <h1>{PROSPECT_FINDER_TITLE}</h1>
          <p className={styles.subtitle}>{PROSPECT_FINDER_SUBTITLE}</p>
        </div>
        {!disabled && (
          <div className={styles.headerActions}>
            <QuotaIndicator quota={quota} />
            <button
              type="button"
              className={styles.refreshButton}
              onClick={refreshAll}
              disabled={searchesLoading}
              title="Refresh"
              data-discover-tour="refresh"
            >
              <RefreshCw aria-hidden="true" className={searchesLoading ? styles.spin : undefined} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setShowNewSearch(true)}
              data-discover-tour="new-search"
            >
              <Plus aria-hidden="true" />
              <span>New search</span>
            </button>
          </div>
        )}
      </header>

      {actionError && (
        <div className={`${styles.inlineAlert} ${styles.inlineAlertError}`} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{actionError}</span>
          <CircularCloseButton compact label="Dismiss" onClick={() => setActionError(null)} />
        </div>
      )}
      {actionNotice && (
        <div className={styles.inlineAlert} role="status">
          <Sparkles aria-hidden="true" />
          <span>{actionNotice.message}</span>
          <CircularCloseButton compact label="Dismiss" onClick={() => setActionNotice(null)} />
        </div>
      )}

      {pageState === "disabled" && <DisabledState />}

      {pageState === "empty" && (
        <EmptyState
          tourTarget="empty-state"
          icon={<Inbox aria-hidden="true" />}
          title="Your searches will appear here"
          body="Create your first search to discover people at a company and review their inferred work emails."
          action={
            <button type="button" className={styles.primaryButton} onClick={() => setShowNewSearch(true)}>
              <Plus aria-hidden="true" />
              <span>New search</span>
            </button>
          }
        />
      )}

      {(pageState === "ready" || pageState === "loading") && (
        <SearchHistoryTable
          searches={searches}
          total={searchesTotal}
          loading={searchesLoading}
          error={searchesError}
          pageIndex={historyPageIndex}
          pageCount={historyPageCount}
          offset={historyOffset}
          hasNext={searchesHasNext}
          onRequestDelete={handleRequestDelete}
          onPrev={handleHistoryPrev}
          onNext={handleHistoryNext}
        />
      )}

      <NewSearchModal
        open={showNewSearch}
        form={form}
        creating={creating}
        quota={quota}
        onChange={setForm}
        onSubmit={handleCreate}
        onClose={() => setShowNewSearch(false)}
      />

      <DeleteSearchDialog
        search={searchPendingDeletion}
        deleting={deleting}
        error={deleteError}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search History table (list-only). Rows are links to the detail page.
// ---------------------------------------------------------------------------

function SearchHistoryTable({
  searches,
  total,
  loading,
  error,
  pageIndex,
  pageCount,
  offset,
  hasNext,
  onRequestDelete,
  onPrev,
  onNext
}: {
  searches: ProspectSearchNode[];
  total: number;
  loading: boolean;
  error: string | null;
  pageIndex: number;
  pageCount: number;
  offset: number;
  hasNext: boolean;
  onRequestDelete: (search: ProspectSearchNode, trigger: HTMLButtonElement | null) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <section className={`card ${styles.historyPanel}`} aria-label="Search history" data-discover-tour="search-history">
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>Search history</h2>
          <p className={styles.panelSubtitle}>
            {total} {total === 1 ? "search" : "searches"}
          </p>
        </div>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.tableScroll}>
        {loading ? (
          <div className={styles.tableSkeleton}>
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className={styles.skeletonRow} />
            ))}
          </div>
        ) : searches.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            title="No prospect searches yet"
            body="Create a search to start discovering relevant people."
            compact
          />
        ) : (
          <div className={styles.historyTable} role="table" aria-label="Searches">
            <div className={styles.historyHeadRow} role="row">
              <span role="columnheader">Company</span>
              <span role="columnheader">Requested roles</span>
              <span role="columnheader">Location</span>
              <span role="columnheader">People</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Created</span>
              <span role="columnheader" aria-label="Actions" />
            </div>
            {searches.map((search, index) => {
              const roles = search.requestedTitles;
              const location = search.requestedLocations[0] ?? null;
              const domain = search.company?.officialWebsiteDomain ?? search.company?.officialDomain ?? null;
              const companyName = search.company?.name ?? search.requestedCompany;
              return (
                // The whole row navigates via a stretched <Link> overlay, so the row
                // stays a real anchor (cmd/middle-click still open in a new tab) while
                // the delete control is a sibling button raised above it — never a
                // <button> nested inside an <a>.
                <div
                  key={search.id}
                  className={styles.historyRow}
                  data-discover-tour={index === 0 ? "search-row" : undefined}
                >
                  <Link
                    href={`/prospects/${search.id}` as Route}
                    className={styles.historyRowLink}
                    aria-label={`Open ${companyName} search`}
                  />
                  <span className={styles.historyCompanyCell} data-label="Company">
                    <span className={styles.historyCompanyName}>{companyName}</span>
                    {domain && <span className={styles.historyCompanyDomain}>{domain}</span>}
                  </span>
                  <span className={styles.historyRolesCell} data-label="Roles">
                    {roles.length === 0 ? (
                      <span className={styles.historyMutedText}>—</span>
                    ) : (
                      <>
                        {roles.slice(0, 2).map((role) => (
                          <span key={role} className={styles.historyRoleTag} title={role}>
                            {role}
                          </span>
                        ))}
                        {roles.length > 2 && <span className={styles.historyRoleTag}>+{roles.length - 2} more</span>}
                      </>
                    )}
                  </span>
                  <span className={styles.historyLocationCell} data-label="Location" title={location ?? undefined}>
                    {location ?? "Any location"}
                  </span>
                  <span className={styles.historyPeopleCell} data-label="People">
                    {search.peopleCount}
                  </span>
                  <span data-label="Status" data-discover-tour={index === 0 ? "search-status" : undefined}>
                    <BadgePill badge={statusBadge(search.status)} />
                  </span>
                  <span className={styles.historyCreatedCell} data-label="Created">
                    {formatDateTime(search.createdAt)}
                  </span>
                  <span className={styles.historyActionsCell} data-label="Actions">
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.historyDeleteButton}`}
                      aria-label={`Delete ${companyName} search`}
                      title="Delete search"
                      onClick={(event) => {
                        // Keep the row's stretched link from navigating (covers mouse
                        // and keyboard activation), then open the in-app dialog.
                        event.preventDefault();
                        event.stopPropagation();
                        onRequestDelete(search, event.currentTarget);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                    <ChevronRight aria-hidden="true" className={styles.historyActionsChevron} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.paginationRow} data-discover-tour={pageCount > 1 ? "history-pagination" : undefined}>
        <span className={styles.peopleShowing}>
          {formatShowingLabel({ offset, pageCount: searches.length, totalCount: total })}
        </span>
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pagerButton}
            onClick={onPrev}
            disabled={pageIndex === 0 || loading}
            aria-label="Previous page"
            title="Previous page"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span className={styles.pageInfo}>{formatPageLabel({ pageIndex, pageCount })}</span>
          <button
            type="button"
            className={styles.pagerButton}
            onClick={onNext}
            disabled={!hasNext || loading}
            aria-label="Next page"
            title="Next page"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog (in-app, replaces the old native browser confirm).
// ---------------------------------------------------------------------------

function DeleteSearchDialog({
  search,
  deleting,
  error,
  onCancel,
  onConfirm
}: {
  search: ProspectSearchNode | null;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape closes the dialog, but never while a delete is in flight.
  useEffect(() => {
    if (!search) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, deleting, onCancel]);

  // Move focus into the dialog when it opens. The destructive action is NOT
  // auto-focused; the Cancel button is, so Enter never deletes by accident.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (search) {
      cancelRef.current?.focus();
    }
  }, [search]);

  if (!search) {
    return null;
  }

  const companyName = search.company?.name ?? search.requestedCompany;
  const titleId = "discover-delete-title";
  const descId = "discover-delete-desc";

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        // Backdrop click closes — never while deleting, never from inside the card.
        if (event.target === event.currentTarget && !deleting) {
          onCancel();
        }
      }}
    >
      <div
        className={`card ${styles.modalCard} ${styles.confirmCard}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <span className={styles.confirmIcon} aria-hidden="true">
          <Trash2 />
        </span>
        <h2 id={titleId} className={styles.panelTitle}>
          Delete this search?
        </h2>
        <p id={descId} className={styles.confirmBody}>
          {`This will remove the “${companyName}” search and its saved Discover results. Imports or sequences created separately will not be deleted.`}
        </p>
        {error && (
          <div className={`${styles.inlineAlert} ${styles.inlineAlertError}`} role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className={styles.modalActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Trash2 aria-hidden="true" />}
            {deleting ? "Deleting…" : "Delete search"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New search modal + usage panel (list-only).
// ---------------------------------------------------------------------------

function NewSearchModal({
  open,
  form,
  creating,
  quota,
  onChange,
  onSubmit,
  onClose
}: {
  open: boolean;
  form: CreateForm;
  creating: boolean;
  quota: DiscoverQuota | null;
  onChange: (form: CreateForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Create discovery search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form className={`card ${styles.modalCard}`} onSubmit={onSubmit}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Create discovery search</h2>
            <p className={styles.panelSubtitle}>Creates a draft. Process it to fetch people.</p>
          </div>
          <CircularCloseButton label="Close new search" onClick={onClose} />
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Company name</span>
          <input
            className={styles.input}
            value={form.companyName}
            onChange={(event) => onChange({ ...form, companyName: event.target.value })}
            placeholder="Stripe"
            required
            autoFocus
          />
          <span className={styles.fieldHint}>Enter the company whose professionals you want to find.</span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Job titles</span>
          <input
            className={styles.input}
            value={form.jobTitles}
            onChange={(event) => onChange({ ...form, jobTitles: event.target.value })}
            placeholder="Software Engineer, Recruiter"
          />
          <span className={styles.fieldHint}>
            Add one or more roles separated by commas, such as Software Engineer, Recruiter, or Data Analyst.
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Locations</span>
          <input
            className={styles.input}
            value={form.locations}
            onChange={(event) => onChange({ ...form, locations: event.target.value })}
            placeholder="United States"
          />
          <span className={styles.fieldHint}>Enter a country, state, city, or professional region to narrow the search.</span>
        </label>
        <DiscoverUsagePanel quota={quota} />
        <div className={styles.modalActions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryButton} disabled={creating}>
            {creating ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Plus aria-hidden="true" />}
            Create draft search
          </button>
        </div>
      </form>
    </div>
  );
}

function DiscoverUsagePanel({ quota }: { quota: DiscoverQuota | null }) {
  const remaining = formatQuotaRemaining(quota);
  const resetLabel = formatQuotaReset(quota);
  return (
    <div className={styles.usagePanel}>
      <span className={styles.usagePanelStrong}>{discoverPerSearchSentence(quota)}</span>
      {quota?.unlimited ? (
        <span className={styles.usagePanelRow}>Unlimited Discover access</span>
      ) : remaining ? (
        <>
          <span className={styles.usagePanelRow}>{remaining}</span>
          {resetLabel && <span className={styles.usagePanelRow}>{resetLabel}</span>}
        </>
      ) : (
        <span className={styles.usagePanelRow}>{quota?.dailySearchLimit ?? 4} Discover searches available per day.</span>
      )}
    </div>
  );
}
