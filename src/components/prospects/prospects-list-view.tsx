"use client";

// Discover LIST page (/prospects). Shows only the Discover header, daily quota,
// Refresh, New search, the empty state, and the Search History table. Selecting
// a row navigates to the dedicated detail page (/prospects/[searchId]); this page
// never renders company details, the People table, or selection/export actions.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  Trash2,
  X
} from "lucide-react";

import { CircularCloseButton } from "@/components/circular-close-button";
import { SuggestionInput } from "@/components/prospects/suggestion-input";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { titleCaseLabel } from "@/services/prospects/discover-suggestions";
import {
  CREATE_SEARCH_MUTATION,
  DELETE_COMPANY_MUTATION,
  DELETE_SEARCH_MUTATION,
  DISCOVER_COMPANY_GROUPS_QUERY,
  DISCOVER_QUOTA_QUERY,
  SEARCHES_PAGE_SIZE,
  buildSearchesVariables,
  prospectGraphql,
  type Connection,
  type DiscoverCompanyGroupNode,
  type DiscoverQuota,
  type DiscoverSuggestion
} from "@/components/prospects/prospect-graphql";
import {
  PROSPECT_FINDER_SUBTITLE,
  PROSPECT_FINDER_TITLE,
  discoverPerSearchSentence,
  filterHistoryGroups,
  effectiveSearchStatus,
  formatDateTime,
  formatFilteredGroupCountLabel,
  formatHistoryMatchesLabel,
  formatPageLabel,
  formatQuotaRemaining,
  formatQuotaReset,
  formatShowingLabel,
  groupStatusBadge,
  resolveGroupOpenTarget,
  resolveHistoryPageAfterDelete,
  resolvePageCount,
  resolveProspectPageState
} from "@/components/prospects/prospect-view";
import {
  BadgePill,
  DisabledState,
  EmptyState,
  QuotaStatChip,
  EMPTY_FORM,
  type ActionNotice,
  type CreateForm
} from "@/components/prospects/prospects-shared";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/prospects/prospects-dashboard.module.css";

// Conservative shape check before forwarding a picked company's domain to the
// create mutation (which validates it authoritatively). Never a full validator —
// just enough to avoid sending an obviously malformed value.
function isLikelyDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
}

export function ProspectsListView({ featureEnabled }: { featureEnabled: boolean }) {
  const router = useRouter();
  const [disabled, setDisabled] = useState(!featureEnabled);

  // One row per company: the grouped Search History read model.
  const [searches, setSearches] = useState<DiscoverCompanyGroupNode[]>([]);
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
  // When the user PICKS a company suggestion we remember its resolved domain so
  // the create can carry it for canonical dedupe. It is only ever sent while the
  // typed name still matches the picked suggestion (see handleCreate), so a later
  // manual edit never sends a stale domain.
  const [companyHint, setCompanyHint] = useState<{ name: string; domain: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  // In-app delete confirmation state (replaces the old native browser confirm).
  const [searchPendingDeletion, setSearchPendingDeletion] = useState<DiscoverCompanyGroupNode | null>(null);
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
    const result = await prospectGraphql<{ discoverCompanyGroups: Connection<DiscoverCompanyGroupNode> }>(
      DISCOVER_COMPANY_GROUPS_QUERY,
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
    const connection = result.data.discoverCompanyGroups;
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
  // navigates to the detail page; it just records which company group is pending
  // (and the trigger button so focus can return to it on cancel).
  const handleRequestDelete = useCallback((group: DiscoverCompanyGroupNode, trigger: HTMLButtonElement | null) => {
    deleteTriggerRef.current = trigger;
    setDeleteError(null);
    setSearchPendingDeletion(group);
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
  // client (same CSRF/auth as every Discover mutation). A resolved company group
  // deletes THIS USER's whole company entry (all of their role searches +
  // allocated results — never the shared cache or another user's data); an
  // unresolved single-search entry deletes just that search. The row + count
  // update and the success toast appear only after the backend confirms; on
  // failure the dialog stays open with a safe message and the row is preserved.
  const handleConfirmDelete = useCallback(async () => {
    const group = searchPendingDeletion;
    if (!group || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const result = group.company
      ? await prospectGraphql<{ deleteCompany: boolean }>(DELETE_COMPANY_MUTATION, {
          companyId: group.company.id
        })
      : await prospectGraphql<{ deleteProspectSearch: boolean }>(DELETE_SEARCH_MUTATION, {
          id: group.searches[0]?.id ?? group.id
        });
    if (result.disabled) {
      setDeleting(false);
      setSearchPendingDeletion(null);
      setDisabled(true);
      return;
    }
    const confirmed = group.company
      ? Boolean((result.data as { deleteCompany?: boolean } | null)?.deleteCompany)
      : Boolean((result.data as { deleteProspectSearch?: boolean } | null)?.deleteProspectSearch);
    if (result.error || !confirmed) {
      // Keep the dialog open with a safe product message — never a raw backend error.
      setDeleting(false);
      setDeleteError("This company could not be deleted. Please try again.");
      return;
    }
    // Success: remove the row + update the count, then surface the toast.
    const remaining = searches.filter((item) => item.id !== group.id);
    setSearches(remaining);
    setSearchesTotal((total) => Math.max(0, total - 1));
    setDeleting(false);
    setSearchPendingDeletion(null);
    setActionError(null);
    setActionNotice({ message: `${group.company?.name ?? group.displayName} was removed from Discover.` });
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
      const companyName = form.companyName.trim();
      const jobTitles = form.jobTitles.split(",").map((value) => value.trim()).filter(Boolean);
      const locations = form.locations.split(",").map((value) => value.trim()).filter(Boolean);
      if (!companyName || jobTitles.length === 0) {
        setActionError("Enter a company name and at least one job title.");
        return;
      }
      // Carry the picked company's domain ONLY while the typed name still matches
      // it — a manual edit after selecting drops the hint so no stale domain is
      // ever sent. The backend still re-resolves and de-dupes authoritatively.
      const companyDomain =
        companyHint &&
        companyHint.domain &&
        isLikelyDomain(companyHint.domain) &&
        companyHint.name.trim().toLowerCase() === companyName.toLowerCase()
          ? companyHint.domain
          : null;
      setCreating(true);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ createProspectSearch: { id: string } }>(CREATE_SEARCH_MUTATION, {
        input: { companyName, jobTitles, locations, ...(companyDomain ? { companyDomain } : {}) }
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
      setCompanyHint(null);
      setShowNewSearch(false);
      router.push(`/prospects/${result.data.createProspectSearch.id}` as Route);
    },
    [companyHint, form, router]
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
      <WorkspacePageHeader
        data-discover-tour="page-intro"
        title={PROSPECT_FINDER_TITLE}
        subtitle={PROSPECT_FINDER_SUBTITLE}
        actions={
          !disabled ? (
            <>
              {/* Compact "2/4" chip — the full sentence lives in its aria-label
                  and hover/focus helper card, so the action row stays quiet. */}
              <QuotaStatChip quota={quota} variant="headerAction" />
              <button
                type="button"
                className="button secondary"
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
                className="button"
                onClick={() => setShowNewSearch(true)}
                data-discover-tour="new-search"
              >
                <Plus aria-hidden="true" />
                <span>New search</span>
              </button>
            </>
          ) : undefined
        }
      />

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
        onCompanySelect={(suggestion) =>
          // Resolved companies — the user's own (companyId) or global identity
          // rows (canonicalKey) — carry a domain hint; raw history strings don't.
          setCompanyHint(
            suggestion.companyId || suggestion.canonicalKey
              ? { name: suggestion.value, domain: suggestion.detail }
              : null
          )
        }
        onSubmit={handleCreate}
        onClose={() => {
          setCompanyHint(null);
          setShowNewSearch(false);
        }}
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
// Search History table (list-only). One row per COMPANY: all of the user's role
// searches for the same resolved company render as a single consolidated entry
// (role chips + unique allocated people count). Rows link to the detail page of
// the group's newest ready child search.
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
  searches: DiscoverCompanyGroupNode[];
  total: number;
  loading: boolean;
  error: string | null;
  pageIndex: number;
  pageCount: number;
  offset: number;
  hasNext: boolean;
  onRequestDelete: (group: DiscoverCompanyGroupNode, trigger: HTMLButtonElement | null) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Client-side filter over the rows already loaded for this page. Typing never
  // calls the backend; it only narrows what is visible, and the pager still
  // moves between server pages with the filter kept applied.
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const hasFilterQuery = filterQuery.trim().length > 0;
  const visibleSearches = useMemo(() => filterHistoryGroups(searches, filterQuery), [searches, filterQuery]);

  const clearFilter = useCallback(() => {
    setFilterQuery("");
    filterInputRef.current?.focus();
  }, []);

  return (
    <section className={`card ${styles.historyPanel}`} aria-label="Search history" data-discover-tour="search-history">
      <div className={`${styles.panelHeader} ${styles.historyPanelHeader}`}>
        <div>
          <h2 className={styles.panelTitle}>Search history</h2>
          <p className={styles.panelSubtitle} aria-live="polite">
            {formatFilteredGroupCountLabel({
              filteredCount: visibleSearches.length,
              totalCount: total,
              hasQuery: hasFilterQuery
            })}
          </p>
        </div>
        <div className={styles.historySearch} role="search">
          <Search aria-hidden="true" className={styles.historySearchIcon} />
          <input
            ref={filterInputRef}
            type="text"
            className={styles.historySearchInput}
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears the filter (only intercepted while there is one).
              if (event.key === "Escape" && filterQuery) {
                event.preventDefault();
                event.stopPropagation();
                setFilterQuery("");
              }
            }}
            placeholder="Search company, role, domain, or location"
            aria-label="Search Discover history"
            autoComplete="off"
            spellCheck={false}
          />
          {filterQuery && (
            <button
              type="button"
              className={styles.historySearchClear}
              aria-label="Clear Discover history search"
              title="Clear search"
              onClick={clearFilter}
            >
              <X aria-hidden="true" />
            </button>
          )}
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
        ) : visibleSearches.length === 0 ? (
          // History exists but the current filter has no matches — distinct
          // from the no-history-at-all state above.
          <EmptyState
            icon={<SearchX aria-hidden="true" />}
            title="No matching searches"
            body="Try another company, role, domain, or location."
            compact
            action={
              <button type="button" className={styles.secondaryButton} onClick={clearFilter}>
                Clear search
              </button>
            }
          />
        ) : (
          <div className={styles.historyTable} role="table" aria-label="Searches">
            <div className={styles.historyHeadRow} role="row">
              <span role="columnheader">Company</span>
              <span role="columnheader">Requested roles</span>
              <span role="columnheader">Location</span>
              <span role="columnheader">People</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Updated</span>
              <span role="columnheader" aria-label="Actions" />
            </div>
            {visibleSearches.map((group, index) => {
              // Display clean, canonical labels even for older rows stored with
              // broken casing ("SOftware Engineer" → "Software Engineer").
              const roles = group.requestedRoles.map((role) => titleCaseLabel(role));
              const location = group.locations[0] ? titleCaseLabel(group.locations[0]) : null;
              const domain = group.company?.officialWebsiteDomain ?? group.company?.officialDomain ?? null;
              const companyName = group.company?.name ?? group.displayName;
              const openTarget = resolveGroupOpenTarget(group.searches);
              return (
                // The whole row navigates via a stretched <Link> overlay, so the row
                // stays a real anchor (cmd/middle-click still open in a new tab) while
                // the delete control is a sibling button raised above it — never a
                // <button> nested inside an <a>.
                <div
                  key={group.id}
                  className={styles.historyRow}
                  data-discover-tour={index === 0 ? "search-row" : undefined}
                >
                  {openTarget && (
                    <Link
                      href={`/prospects/${openTarget.id}` as Route}
                      className={styles.historyRowLink}
                      aria-label={`Open ${companyName} search`}
                    />
                  )}
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
                    {group.peopleCount}
                  </span>
                  <span data-label="Status" data-discover-tour={index === 0 ? "search-status" : undefined}>
                    {/* Effective statuses: a zero-result child (NO_RESULTS, or a
                        legacy READY row with nobody) must never read "Ready". */}
                    <BadgePill badge={groupStatusBadge(group.searches.map((search) => effectiveSearchStatus(search)))} />
                  </span>
                  <span className={styles.historyCreatedCell} data-label="Updated">
                    {formatDateTime(group.latestActivityAt)}
                  </span>
                  <span className={styles.historyActionsCell} data-label="Actions">
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.historyDeleteButton}`}
                      aria-label={`Delete ${companyName} from Discover`}
                      title="Delete from Discover"
                      onClick={(event) => {
                        // Keep the row's stretched link from navigating (covers mouse
                        // and keyboard activation), then open the in-app dialog.
                        event.preventDefault();
                        event.stopPropagation();
                        onRequestDelete(group, event.currentTarget);
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
          {hasFilterQuery
            ? formatHistoryMatchesLabel(visibleSearches.length)
            : formatShowingLabel({ offset, pageCount: searches.length, totalCount: total })}
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
  search: DiscoverCompanyGroupNode | null;
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

  const companyName = search.company?.name ?? search.displayName;
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
          {`Delete ${companyName} from Discover?`}
        </h2>
        <p id={descId} className={styles.confirmBody}>
          {`This removes your ${companyName} search history and allocated Discover results. Shared cached company data and other users’ searches are not affected. Imports or sequences created separately will not be deleted.`}
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
            {deleting ? "Deleting…" : "Delete"}
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
  onCompanySelect,
  onSubmit,
  onClose
}: {
  open: boolean;
  form: CreateForm;
  creating: boolean;
  quota: DiscoverQuota | null;
  onChange: (form: CreateForm) => void;
  onCompanySelect: (suggestion: DiscoverSuggestion) => void;
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
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Company name</span>
          <SuggestionInput
            type="COMPANY"
            value={form.companyName}
            onChange={(value) => onChange({ ...form, companyName: value })}
            onSelectSuggestion={onCompanySelect}
            placeholder="Stripe"
            ariaLabel="Company name"
            required
            autoFocus
          />
          <span className={styles.fieldHint}>Enter the company whose professionals you want to find.</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Job titles</span>
          <SuggestionInput
            type="ROLE"
            multiToken
            value={form.jobTitles}
            onChange={(value) => onChange({ ...form, jobTitles: value })}
            placeholder="Software Engineer, Recruiter"
            ariaLabel="Job titles"
          />
          <span className={styles.fieldHint}>
            Add one or more roles separated by commas, such as Software Engineer, Recruiter, or Data Analyst.
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Locations</span>
          <SuggestionInput
            type="LOCATION"
            multiToken
            value={form.locations}
            onChange={(value) => onChange({ ...form, locations: value })}
            placeholder="United States"
            ariaLabel="Locations"
          />
          <span className={styles.fieldHint}>Enter a country, state, city, or professional region to narrow the search.</span>
        </div>
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
