"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  AtSign,
  Ban,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Inbox,
  LoaderCircle,
  MapPin,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";

import {
  CANCEL_SEARCH_MUTATION,
  COMPANY_DETAIL_QUERY,
  CREATE_SEARCH_MUTATION,
  DELETE_COMPANY_MUTATION,
  PEOPLE_PAGE_SIZE,
  PEOPLE_QUERY,
  PROCESS_SEARCH_MUTATION,
  PROSPECT_SEARCHES_QUERY,
  REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
  SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION,
  buildPeopleVariables,
  buildSearchesVariables,
  prospectGraphql,
  type CompanyDetail,
  type ConfidenceLevel,
  type Connection,
  type PersonNode,
  type PositionCategory,
  type ProspectSearchNode
} from "@/components/prospects/prospect-graphql";
import {
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  type Badge,
  type BadgeTone,
  confidenceBadge,
  emailStatusBadge,
  filterPeopleByText,
  formatDateTime,
  formatSearchError,
  formatShowingLabel,
  isEmailCopyable,
  personLocation,
  resolveProspectPageState,
  resolveSelectedSearchView,
  statusBadge
} from "@/components/prospects/prospect-view";
import styles from "@/components/prospects/prospects-dashboard.module.css";

const TONE_CLASS: Record<BadgeTone, string> = {
  verified: styles.toneVerified,
  inferred: styles.toneInferred,
  neutral: styles.toneNeutral,
  warning: styles.toneWarning,
  muted: styles.toneMuted,
  blocked: styles.toneBlocked
};

function BadgePill({ badge }: { badge: Badge }) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[badge.tone]}`} title={badge.hint}>
      {badge.label}
    </span>
  );
}

type CreateForm = {
  companyName: string;
  jobTitles: string;
  locations: string;
  maxResults: string;
};

const EMPTY_FORM: CreateForm = { companyName: "", jobTitles: "", locations: "", maxResults: "25" };
const EMAIL_PATTERN_OPTIONS = [
  "first",
  "last",
  "firstlast",
  "first.last",
  "first_last",
  "flast",
  "f.last",
  "f_last",
  "firstl",
  "first.l",
  "lastf",
  "last.first"
];

export function ProspectsDashboard({ featureEnabled }: { featureEnabled: boolean }) {
  const [disabled, setDisabled] = useState(!featureEnabled);

  const [searches, setSearches] = useState<ProspectSearchNode[]>([]);
  const [searchesLoading, setSearchesLoading] = useState(true);
  const [searchesError, setSearchesError] = useState<string | null>(null);
  const [searchesHasNext, setSearchesHasNext] = useState(false);
  const [searchesEndCursor, setSearchesEndCursor] = useState<string | null>(null);
  const [searchesTotal, setSearchesTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);

  const [activeCategory, setActiveCategory] = useState<PositionCategory | null>(null);

  const [people, setPeople] = useState<PersonNode[]>([]);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleHasNext, setPeopleHasNext] = useState(false);
  const [peopleEndCursor, setPeopleEndCursor] = useState<string | null>(null);
  const [peoplePageIndex, setPeoplePageIndex] = useState(0);
  const peopleAfterCursors = useRef<(string | null)[]>([null]);

  const [peopleFilter, setPeopleFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showNewSearch, setShowNewSearch] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [refreshingFormatId, setRefreshingFormatId] = useState<string | null>(null);
  const [formatSourceUrl, setFormatSourceUrl] = useState("");
  const [showFormatSource, setShowFormatSource] = useState(false);
  const [showManualFormat, setShowManualFormat] = useState(false);
  const [manualEmailDomain, setManualEmailDomain] = useState("");
  const [manualEmailPattern, setManualEmailPattern] = useState("first.last");
  const [manualConfidence, setManualConfidence] = useState<ConfidenceLevel>("HIGH");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const peopleReq = useRef(0);
  const companyReq = useRef(0);

  const selectedSearch = useMemo(
    () => searches.find((item) => item.id === selectedSearchId) ?? null,
    [searches, selectedSearchId]
  );
  const selectedView = resolveSelectedSearchView(selectedSearch);
  const pageState = resolveProspectPageState({ disabled, loading: searchesLoading, searchCount: searches.length });

  const loadCompany = useCallback(async (companyId: string) => {
    const req = ++companyReq.current;
    setCompanyLoading(true);
    const result = await prospectGraphql<{ company: CompanyDetail | null }>(COMPANY_DETAIL_QUERY, { id: companyId });
    if (req !== companyReq.current) {
      return;
    }
    if (result.disabled) {
      setDisabled(true);
    } else if (result.data?.company) {
      setCompany(result.data.company);
    }
    setCompanyLoading(false);
  }, []);

  const loadPeople = useCallback(
    async (args: { companyId: string; category: PositionCategory | null; pageIndex: number; after: string | null }) => {
      const req = ++peopleReq.current;
      setPeopleLoading(true);
      setPeopleError(null);
      const result = await prospectGraphql<{ people: Connection<PersonNode> }>(
        PEOPLE_QUERY,
        buildPeopleVariables({ companyId: args.companyId, category: args.category, after: args.after })
      );
      if (req !== peopleReq.current) {
        return;
      }
      if (result.disabled) {
        setDisabled(true);
        setPeopleLoading(false);
        return;
      }
      if (result.error || !result.data) {
        setPeopleError(result.error ?? "Could not load people.");
        setPeopleLoading(false);
        return;
      }
      const connection = result.data.people;
      setPeople(connection.edges.map((edge) => edge.node));
      setPeopleTotal(connection.totalCount);
      setPeopleHasNext(connection.pageInfo.hasNextPage);
      setPeopleEndCursor(connection.pageInfo.endCursor);
      setPeoplePageIndex(args.pageIndex);
      setPeopleLoading(false);
    },
    []
  );

  const resetPeopleState = useCallback(() => {
    peopleAfterCursors.current = [null];
    setPeople([]);
    setPeopleTotal(0);
    setPeopleHasNext(false);
    setPeopleEndCursor(null);
    setPeoplePageIndex(0);
    setPeopleFilter("");
  }, []);

  const selectSearch = useCallback(
    (search: ProspectSearchNode) => {
      setSelectedSearchId(search.id);
      setActiveCategory(null);
      setActionError(null);
      setActionNotice(null);
      setCompany(null);
      setFormatSourceUrl("");
      setShowFormatSource(false);
      setShowManualFormat(false);
      setManualEmailDomain("");
      setManualEmailPattern("first.last");
      setManualConfidence("HIGH");
      resetPeopleState();
      if (search.status === "READY" && search.company) {
        void loadCompany(search.company.id);
        void loadPeople({ companyId: search.company.id, category: null, pageIndex: 0, after: null });
      }
    },
    [loadCompany, loadPeople, resetPeopleState]
  );

  const loadSearches = useCallback(
    async (options?: { autoSelect?: boolean }) => {
      setSearchesLoading(true);
      setSearchesError(null);
      const result = await prospectGraphql<{ prospectSearches: Connection<ProspectSearchNode> }>(
        PROSPECT_SEARCHES_QUERY,
        buildSearchesVariables()
      );
      if (result.disabled) {
        setDisabled(true);
        setSearchesLoading(false);
        return;
      }
      // Backend reachable and enabled — clear any stale server-rendered hint.
      setDisabled(false);
      if (result.error || !result.data) {
        setSearchesError(result.error ?? "Could not load prospect searches.");
        setSearchesLoading(false);
        return;
      }
      const connection = result.data.prospectSearches;
      const nodes = connection.edges.map((edge) => edge.node);
      setSearches(nodes);
      setSearchesHasNext(connection.pageInfo.hasNextPage);
      setSearchesEndCursor(connection.pageInfo.endCursor);
      setSearchesTotal(connection.totalCount);
      setSearchesLoading(false);
      if (options?.autoSelect && nodes.length > 0) {
        const preferred = nodes.find((node) => node.status === "READY" && node.company) ?? nodes[0];
        selectSearch(preferred);
      }
    },
    [selectSearch]
  );

  const loadMoreSearches = useCallback(async () => {
    if (!searchesHasNext || loadingMore) {
      return;
    }
    setLoadingMore(true);
    const result = await prospectGraphql<{ prospectSearches: Connection<ProspectSearchNode> }>(
      PROSPECT_SEARCHES_QUERY,
      buildSearchesVariables({ after: searchesEndCursor })
    );
    if (!result.disabled && result.data) {
      const connection = result.data.prospectSearches;
      setSearches((prev) => [...prev, ...connection.edges.map((edge) => edge.node)]);
      setSearchesHasNext(connection.pageInfo.hasNextPage);
      setSearchesEndCursor(connection.pageInfo.endCursor);
    } else if (result.disabled) {
      setDisabled(true);
    }
    setLoadingMore(false);
  }, [loadingMore, searchesEndCursor, searchesHasNext]);

  useEffect(() => {
    // Always verify against the live endpoint rather than trusting the
    // server-rendered `featureEnabled` hint alone. If that hint is stale (e.g. a
    // dev server that cached an older env) but the backend is actually enabled,
    // this recovers instead of stranding the user on the disabled card. A
    // genuinely disabled backend returns 404 and loadSearches re-sets `disabled`.
    void loadSearches({ autoSelect: true });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectCategory = useCallback(
    (category: PositionCategory | null) => {
      if (!company) {
        return;
      }
      setActiveCategory(category);
      peopleAfterCursors.current = [null];
      setPeopleFilter("");
      void loadPeople({ companyId: company.id, category, pageIndex: 0, after: null });
    },
    [company, loadPeople]
  );

  const handlePeopleNext = useCallback(() => {
    if (!company || !peopleHasNext) {
      return;
    }
    const after = peopleEndCursor;
    peopleAfterCursors.current[peoplePageIndex + 1] = after;
    void loadPeople({ companyId: company.id, category: activeCategory, pageIndex: peoplePageIndex + 1, after });
  }, [activeCategory, company, loadPeople, peopleEndCursor, peopleHasNext, peoplePageIndex]);

  const handlePeoplePrev = useCallback(() => {
    if (!company || peoplePageIndex === 0) {
      return;
    }
    const after = peopleAfterCursors.current[peoplePageIndex - 1] ?? null;
    void loadPeople({ companyId: company.id, category: activeCategory, pageIndex: peoplePageIndex - 1, after });
  }, [activeCategory, company, loadPeople, peoplePageIndex]);

  const handleCopyEmail = useCallback(async (person: PersonNode) => {
    if (!person.inferredEmail) {
      return;
    }
    try {
      await navigator.clipboard.writeText(person.inferredEmail);
      setCopiedId(person.id);
      window.setTimeout(() => setCopiedId((current) => (current === person.id ? null : current)), 1600);
    } catch {
      setActionError("Copy is unavailable in this browser.");
    }
  }, []);

  const refreshAll = useCallback(() => {
    setActionError(null);
    setActionNotice(null);
    void (async () => {
      await loadSearches();
      if (selectedSearch?.status === "READY" && selectedSearch.company) {
        await loadCompany(selectedSearch.company.id);
        await loadPeople({ companyId: selectedSearch.company.id, category: activeCategory, pageIndex: 0, after: null });
        peopleAfterCursors.current = [null];
      }
    })();
  }, [activeCategory, loadCompany, loadPeople, loadSearches, selectedSearch]);

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
      const maxResults = Number.parseInt(form.maxResults, 10);
      const result = await prospectGraphql<{ createProspectSearch: { id: string } }>(CREATE_SEARCH_MUTATION, {
        input: {
          companyName: form.companyName.trim(),
          jobTitles,
          locations,
          maxResults: Number.isFinite(maxResults) ? maxResults : 25
        }
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
      const newId = result.data.createProspectSearch.id;
      setForm(EMPTY_FORM);
      setShowNewSearch(false);
      setActionNotice("Draft search created. Select it and run Process to fetch people.");
      await loadSearches();
      setSelectedSearchId(newId);
    },
    [form, loadSearches]
  );

  const handleProcess = useCallback(
    async (search: ProspectSearchNode) => {
      setProcessingId(search.id);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ processProspectSearch: { id: string; status: string } }>(
        PROCESS_SEARCH_MUTATION,
        { id: search.id }
      );
      setProcessingId(null);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Processing failed. Try again with fewer results.");
        await loadSearches();
        return;
      }
      await loadSearches();
      const updated = result.data.processProspectSearch;
      const refreshed = await prospectGraphql<{ prospectSearches: Connection<ProspectSearchNode> }>(
        PROSPECT_SEARCHES_QUERY,
        buildSearchesVariables()
      );
      const node = refreshed.data?.prospectSearches.edges.map((edge) => edge.node).find((item) => item.id === updated.id);
      if (node) {
        selectSearch(node);
      }
    },
    [loadSearches, selectSearch]
  );

  const handleCancel = useCallback(
    async (search: ProspectSearchNode) => {
      setActionError(null);
      const result = await prospectGraphql<{ cancelProspectSearch: { id: string } }>(CANCEL_SEARCH_MUTATION, {
        id: search.id
      });
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error) {
        setActionError(result.error);
        return;
      }
      await loadSearches();
    },
    [loadSearches]
  );

  const handleDeleteCompany = useCallback(
    async (target: CompanyDetail) => {
      const confirmed = window.confirm(
        `Delete ${target.name} and its prospect graph? This removes the company, its inferred people, and related searches.`
      );
      if (!confirmed) {
        return;
      }

      setDeletingCompanyId(target.id);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ deleteCompany: boolean }>(DELETE_COMPANY_MUTATION, {
        companyId: target.id
      });
      setDeletingCompanyId(null);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data?.deleteCompany) {
        setActionError(result.error ?? "Could not delete this company.");
        return;
      }

      setSelectedSearchId(null);
      setCompany(null);
      setActiveCategory(null);
      resetPeopleState();
      setActionNotice("Company deleted.");
      await loadSearches({ autoSelect: true });
    },
    [loadSearches, resetPeopleState]
  );

  const reloadCompanyPeople = useCallback(
    async (updatedCompany: CompanyDetail) => {
      setCompany(updatedCompany);
      peopleAfterCursors.current = [null];
      await loadPeople({ companyId: updatedCompany.id, category: activeCategory, pageIndex: 0, after: null });
      await loadSearches();
    },
    [activeCategory, loadPeople, loadSearches]
  );

  const handleRefreshEmailFormat = useCallback(
    async (target: CompanyDetail, sourceUrl?: string | null) => {
      setRefreshingFormatId(target.id);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ refreshCompanyEmailFormat: CompanyDetail }>(
        REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
        { companyId: target.id, sourceUrl: sourceUrl?.trim() || null }
      );
      setRefreshingFormatId(null);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Could not refresh the email format.");
        return;
      }
      await reloadCompanyPeople(result.data.refreshCompanyEmailFormat);
      setActionNotice(
        result.data.refreshCompanyEmailFormat.emailDomain && result.data.refreshCompanyEmailFormat.emailPattern
          ? "Email format refreshed from public evidence."
          : "No evidence-backed email format found yet."
      );
    },
    [reloadCompanyPeople]
  );

  const handleManualEmailFormat = useCallback(
    async (target: CompanyDetail) => {
      setRefreshingFormatId(target.id);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ setCompanyEmailInferenceOverride: CompanyDetail }>(
        SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION,
        {
          companyId: target.id,
          emailDomain: manualEmailDomain.trim(),
          emailPattern: manualEmailPattern,
          confidence: manualConfidence,
          reason: "Manual correction from prospect dashboard"
        }
      );
      setRefreshingFormatId(null);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Could not apply the manual email format.");
        return;
      }
      await reloadCompanyPeople(result.data.setCompanyEmailInferenceOverride);
      setActionNotice("Manual email format applied.");
    },
    [manualConfidence, manualEmailDomain, manualEmailPattern, reloadCompanyPeople]
  );

  const visiblePeople = useMemo(() => filterPeopleByText(people, peopleFilter), [people, peopleFilter]);
  const visibleCategories = useMemo(
    () => (company ? company.positions.filter((position) => position.peopleCount > 0) : []),
    [company]
  );
  const peopleOffset = peoplePageIndex * PEOPLE_PAGE_SIZE;

  // ---- Render -------------------------------------------------------------

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>
            <Network aria-hidden="true" /> Prospect graph
          </p>
          <h1>Prospects</h1>
          <p className={styles.subtitle}>
            Review company graphs, position groups, and inferred business emails before turning them into outreach data.
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.featureBadge} ${disabled ? styles.featureBadgeOff : styles.featureBadgeOn}`}>
            <span className={styles.featureDot} aria-hidden="true" />
            {disabled ? "Graph disabled" : "Graph enabled"}
          </span>
          {!disabled && (
            <button
              type="button"
              className={styles.refreshButton}
              onClick={refreshAll}
              disabled={searchesLoading}
              title="Refresh"
            >
              <RefreshCw aria-hidden="true" className={searchesLoading ? styles.spin : undefined} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </header>

      {actionError && (
        <div className={`${styles.inlineAlert} ${styles.inlineAlertError}`} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {actionNotice && (
        <div className={styles.inlineAlert} role="status">
          <Sparkles aria-hidden="true" />
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {pageState === "disabled" && <DisabledState />}

      {pageState === "loading" && <SearchesSkeleton />}

      {pageState === "empty" && (
        <div className={styles.emptyWrap}>
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            title="No prospect searches yet"
            body="Run a GraphQL search locally or create one here to see company graphs."
          />
          <NewSearchPanel
            open
            form={form}
            creating={creating}
            onChange={setForm}
            onSubmit={handleCreate}
            onToggle={() => setShowNewSearch((value) => !value)}
            alwaysOpen
          />
        </div>
      )}

      {pageState === "ready" && (
        <>
          <SummaryCards search={selectedSearch} company={company} view={selectedView} />

          <div className={styles.panelGrid}>
            <section className={`card ${styles.historyPanel}`} aria-label="Search history">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Search history</h2>
                  <p className={styles.panelSubtitle}>{searchesTotal} total</p>
                </div>
                <button type="button" className={styles.ghostButton} onClick={() => setShowNewSearch((value) => !value)}>
                  <Plus aria-hidden="true" />
                  <span>New</span>
                </button>
              </div>

              <NewSearchPanel
                open={showNewSearch}
                form={form}
                creating={creating}
                onChange={setForm}
                onSubmit={handleCreate}
                onToggle={() => setShowNewSearch((value) => !value)}
              />

              {searchesError && <p className={styles.errorText}>{searchesError}</p>}

              <ul className={styles.searchList}>
                {searches.map((search) => {
                  const badge = statusBadge(search.status);
                  const active = search.id === selectedSearchId;
                  return (
                    <li key={search.id}>
                      <button
                        type="button"
                        className={`${styles.searchItem} ${active ? styles.searchItemActive : ""}`}
                        onClick={() => selectSearch(search)}
                        aria-current={active ? "true" : undefined}
                      >
                        <span className={styles.searchItemTop}>
                          <span className={styles.searchItemCompany}>
                            {search.company?.name ?? search.requestedCompany}
                          </span>
                          <BadgePill badge={badge} />
                        </span>
                        <span className={styles.searchItemMeta}>
                          <span>
                            <Users aria-hidden="true" /> {search.peopleCount}
                          </span>
                          {(search.company?.officialWebsiteDomain ?? search.company?.officialDomain) && (
                            <span className={styles.truncate}>{search.company?.officialWebsiteDomain ?? search.company?.officialDomain}</span>
                          )}
                          <span>{formatDateTime(search.createdAt)}</span>
                        </span>
                        {search.requestedTitles.length > 0 && (
                          <span className={styles.searchItemRoles}>
                            {search.requestedTitles.slice(0, 3).map((title) => (
                              <span key={title} className={styles.roleTag}>
                                {title}
                              </span>
                            ))}
                            {search.requestedTitles.length > 3 && (
                              <span className={styles.roleTag}>+{search.requestedTitles.length - 3}</span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {searchesHasNext && (
                <button type="button" className={styles.secondaryButton} onClick={loadMoreSearches} disabled={loadingMore}>
                  {loadingMore ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
                  Load more
                </button>
              )}
            </section>

            <section className={styles.mainPanel} aria-label="Company and people">
              {selectedView === "none" && (
                <EmptyState
                  icon={<Building2 aria-hidden="true" />}
                  title="Select a search"
                  body="Choose a prospect search on the left to view its company graph and people."
                />
              )}

              {(selectedView === "processing" || selectedView === "canceled") && selectedSearch && (
                <StatusCard
                  search={selectedSearch}
                  processing={processingId === selectedSearch.id}
                  onProcess={() => handleProcess(selectedSearch)}
                  onCancel={() => handleCancel(selectedSearch)}
                />
              )}

              {selectedView === "failed" && selectedSearch && (
                <StatusCard
                  search={selectedSearch}
                  processing={processingId === selectedSearch.id}
                  onProcess={() => handleProcess(selectedSearch)}
                  onCancel={() => handleCancel(selectedSearch)}
                />
              )}

              {selectedView === "ready" && (
                <>
                  <CompanyCard
                    company={company}
                    loading={companyLoading}
                    deleting={Boolean(company && deletingCompanyId === company.id)}
                    refreshingFormat={Boolean(company && refreshingFormatId === company.id)}
                    formatSourceUrl={formatSourceUrl}
                    showFormatSource={showFormatSource}
                    showManualFormat={showManualFormat}
                    manualEmailDomain={manualEmailDomain}
                    manualEmailPattern={manualEmailPattern}
                    manualConfidence={manualConfidence}
                    onFormatSourceUrlChange={setFormatSourceUrl}
                    onToggleFormatSource={() => setShowFormatSource((value) => !value)}
                    onToggleManualFormat={() => setShowManualFormat((value) => !value)}
                    onManualEmailDomainChange={setManualEmailDomain}
                    onManualEmailPatternChange={setManualEmailPattern}
                    onManualConfidenceChange={setManualConfidence}
                    onRefreshEmailFormat={handleRefreshEmailFormat}
                    onManualEmailFormat={handleManualEmailFormat}
                    onDelete={handleDeleteCompany}
                  />

                  {company && (
                    <div className={`card ${styles.peopleSection}`}>
                      <div className={styles.panelHeader}>
                        <div>
                          <h2 className={styles.panelTitle}>People</h2>
                          <p className={styles.panelSubtitle}>{PEOPLE_PAGE_SIZE} per page</p>
                        </div>
                      </div>

                      <div className={styles.categoryRail} role="tablist" aria-label="Position categories">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeCategory === null}
                          className={`${styles.categoryChip} ${activeCategory === null ? styles.categoryChipActive : ""}`}
                          onClick={() => handleSelectCategory(null)}
                        >
                          All people <span className={styles.categoryCount}>{company.peopleCount}</span>
                        </button>
                        {visibleCategories.map((position) => (
                          <button
                            key={position.id}
                            type="button"
                            role="tab"
                            aria-selected={activeCategory === position.category}
                            className={`${styles.categoryChip} ${
                              activeCategory === position.category ? styles.categoryChipActive : ""
                            }`}
                            onClick={() => handleSelectCategory(position.category)}
                            title={position.rawTitles.join(", ")}
                          >
                            {position.displayName} <span className={styles.categoryCount}>{position.peopleCount}</span>
                          </button>
                        ))}
                      </div>

                      <div className={styles.noticeBanner} role="note">
                        <AlertCircle aria-hidden="true" />
                        <span>{INFERRED_EMAIL_NOTICE}</span>
                      </div>

                      <div className={styles.peopleToolbar}>
                        <div className={styles.filterField}>
                          <Search aria-hidden="true" />
                          <input
                            type="search"
                            value={peopleFilter}
                            placeholder="Filter this page by name, title, or email"
                            onChange={(event) => setPeopleFilter(event.target.value)}
                            aria-label="Filter people on this page"
                          />
                        </div>
                        <span className={styles.peopleShowing}>
                          {formatShowingLabel({ offset: peopleOffset, pageCount: people.length, totalCount: peopleTotal })}
                        </span>
                      </div>

                      <PeopleTable
                        people={visiblePeople}
                        loading={peopleLoading}
                        error={peopleError}
                        copiedId={copiedId}
                        onCopy={handleCopyEmail}
                      />

                      <div className={styles.paginationRow}>
                        <button
                          type="button"
                          className={styles.pageButton}
                          onClick={handlePeoplePrev}
                          disabled={peoplePageIndex === 0 || peopleLoading}
                        >
                          <ChevronLeft aria-hidden="true" />
                          Previous
                        </button>
                        <span className={styles.pageInfo}>Page {peoplePageIndex + 1}</span>
                        <button
                          type="button"
                          className={styles.pageButton}
                          onClick={handlePeopleNext}
                          disabled={!peopleHasNext || peopleLoading}
                        >
                          Next
                          <ChevronRight aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCards({
  search,
  company,
  view
}: {
  search: ProspectSearchNode | null;
  company: CompanyDetail | null;
  view: ReturnType<typeof resolveSelectedSearchView>;
}) {
  const status = search ? statusBadge(search.status) : null;
  const pattern = company?.emailPattern ?? search?.company?.emailPattern ?? null;
  const patternConfidence = company?.patternConfidence ?? search?.company?.patternConfidence ?? "UNAVAILABLE";
  const emailDomain = company?.emailDomain ?? search?.company?.emailDomain ?? null;
  const emailDomainConfidence = company?.emailDomainConfidence ?? search?.company?.emailDomainConfidence ?? "UNAVAILABLE";
  const websiteDomain =
    company?.officialWebsiteDomain ??
    company?.officialDomain ??
    search?.company?.officialWebsiteDomain ??
    search?.company?.officialDomain ??
    null;
  const peopleCount = company?.peopleCount ?? search?.company?.peopleCount ?? search?.peopleCount ?? 0;
  const positionCount = company?.positions.filter((position) => position.peopleCount > 0).length ?? 0;
  const domainDiffers = Boolean(websiteDomain && emailDomain && websiteDomain !== emailDomain);

  return (
    <div className={styles.summaryGrid}>
      <div className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryLabel}>
          <Building2 aria-hidden="true" /> Company
        </span>
        <span className={styles.summaryValue}>{company?.name ?? search?.company?.name ?? search?.requestedCompany ?? "—"}</span>
        <span className={styles.summaryMeta}>Website: {websiteDomain ?? "unresolved"}</span>
      </div>

      <div className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryLabel}>
          <Users aria-hidden="true" /> People found
        </span>
        <span className={styles.summaryValue}>{peopleCount}</span>
        <span className={styles.summaryMeta}>{positionCount > 0 ? `${positionCount} position groups` : "Position groups appear when ready"}</span>
      </div>

      <div className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryLabel}>
          <AtSign aria-hidden="true" /> Email pattern
        </span>
        <span className={styles.summaryValue}>{emailDomain ?? "Unavailable"}</span>
        <span className={styles.summaryMeta}>
          {pattern ? <code className={styles.patternCode}>{pattern}</code> : "Pattern unavailable"}
        </span>
        {emailDomain && pattern ? (
          <span className={styles.summaryWarn}>
            Inferred · {confidenceBadge(emailDomainConfidence === "UNAVAILABLE" ? patternConfidence : emailDomainConfidence).label.toLowerCase()} confidence, not verified
          </span>
        ) : (
          <span className={styles.summaryMeta}>Email inference unavailable</span>
        )}
        {domainDiffers && <span className={styles.summaryMeta}>Website differs from email domain</span>}
      </div>

      <div className={`card ${styles.summaryCard}`}>
        <span className={styles.summaryLabel}>
          <Sparkles aria-hidden="true" /> Search status
        </span>
        <span className={styles.summaryValue}>{status ? <BadgePill badge={status} /> : "—"}</span>
        <span className={styles.summaryMeta}>
          {view === "ready" && search?.completedAt ? `Completed ${formatDateTime(search.completedAt)}` : `Created ${formatDateTime(search?.createdAt ?? null)}`}
        </span>
      </div>
    </div>
  );
}

function CompanyCard({
  company,
  loading,
  deleting,
  refreshingFormat,
  formatSourceUrl,
  showFormatSource,
  showManualFormat,
  manualEmailDomain,
  manualEmailPattern,
  manualConfidence,
  onFormatSourceUrlChange,
  onToggleFormatSource,
  onToggleManualFormat,
  onManualEmailDomainChange,
  onManualEmailPatternChange,
  onManualConfidenceChange,
  onRefreshEmailFormat,
  onManualEmailFormat,
  onDelete
}: {
  company: CompanyDetail | null;
  loading: boolean;
  deleting: boolean;
  refreshingFormat: boolean;
  formatSourceUrl: string;
  showFormatSource: boolean;
  showManualFormat: boolean;
  manualEmailDomain: string;
  manualEmailPattern: string;
  manualConfidence: ConfidenceLevel;
  onFormatSourceUrlChange: (value: string) => void;
  onToggleFormatSource: () => void;
  onToggleManualFormat: () => void;
  onManualEmailDomainChange: (value: string) => void;
  onManualEmailPatternChange: (value: string) => void;
  onManualConfidenceChange: (value: ConfidenceLevel) => void;
  onRefreshEmailFormat: (company: CompanyDetail, sourceUrl?: string | null) => void;
  onManualEmailFormat: (company: CompanyDetail) => void;
  onDelete: (company: CompanyDetail) => void;
}) {
  if (loading && !company) {
    return (
      <div className={`card ${styles.companyCard}`}>
        <div className={styles.skeletonLine} style={{ width: "40%" }} />
        <div className={styles.skeletonLine} style={{ width: "70%" }} />
      </div>
    );
  }
  if (!company) {
    return null;
  }
  const websiteDomain = company.officialWebsiteDomain ?? company.officialDomain;
  const emailDomainConfidence = confidenceBadge(company.emailDomainConfidence);
  const patternConfidence = confidenceBadge(company.patternConfidence);
  const domainDiffers = Boolean(websiteDomain && company.emailDomain && websiteDomain !== company.emailDomain);
  const firstDomainEvidence = company.emailDomainEvidence[0] ?? null;
  const firstPatternEvidence = company.patternEvidence[0] ?? null;
  const hasEmailFormat = Boolean(company.emailDomain && company.emailPattern);
  return (
    <div className={`card ${styles.companyCard}`}>
      <div className={styles.companyHeader}>
        <div className={styles.companyIcon} aria-hidden="true">
          <Building2 />
        </div>
        <div className={styles.companyHeading}>
          <h2 className={styles.companyName}>{company.name}</h2>
          <div className={styles.companyLinks}>
            {company.officialWebsite && (
              <a href={company.officialWebsite} target={EXTERNAL_LINK_TARGET} rel={EXTERNAL_LINK_REL}>
                {websiteDomain ?? "Website"} <ExternalLink aria-hidden="true" />
              </a>
            )}
            {company.linkedinUrl && (
              <a href={company.linkedinUrl} target={EXTERNAL_LINK_TARGET} rel={EXTERNAL_LINK_REL}>
                LinkedIn <ExternalLink aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => onDelete(company)}
          disabled={deleting}
          title="Delete company graph"
        >
          {deleting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Trash2 aria-hidden="true" />}
          <span>Delete</span>
        </button>
      </div>
      <div className={styles.companyMetaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Company website</span>
          <span className={styles.metaValue}>{websiteDomain ?? "Unavailable"}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Email domain</span>
          <span className={styles.metaValue}>{company.emailDomain ?? "Unavailable"}</span>
          {domainDiffers && <span className={styles.metaHint}>Different from website</span>}
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Email pattern</span>
          <span className={styles.metaValue}>
            {company.emailPattern ? <code className={styles.patternCode}>{company.emailPattern}</code> : "—"}
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Email confidence</span>
          <BadgePill badge={emailDomainConfidence} />
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Pattern confidence</span>
          <BadgePill badge={patternConfidence} />
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>People</span>
          <span className={styles.metaValue}>{company.peopleCount}</span>
        </div>
      </div>
      <div className={styles.evidencePanel}>
        <span className={styles.metaLabel}>Evidence</span>
        {firstDomainEvidence || firstPatternEvidence ? (
          <div className={styles.evidenceList}>
            {firstDomainEvidence && (
              <EvidenceItem
                label={`Email domain: ${firstDomainEvidence.emailDomain}`}
                sourceName={firstDomainEvidence.sourceName}
                sourceUrl={firstDomainEvidence.sourceUrl}
              />
            )}
            {firstPatternEvidence && (
              <EvidenceItem
                label={`Pattern: ${firstPatternEvidence.pattern}`}
                sourceName={firstPatternEvidence.sourceName}
                sourceUrl={firstPatternEvidence.sourceUrl}
              />
            )}
          </div>
        ) : (
          <span className={styles.metaHint}>No evidence-backed email format found yet. Search public sources or set the format manually.</span>
        )}
      </div>
      <div className={styles.formatActions}>
        <div className={styles.formatActionText}>
          <span className={styles.metaLabel}>Email format discovery</span>
          <span className={styles.metaHint}>
            {hasEmailFormat
              ? "Email format found from public evidence. Generated emails are inferred until verified."
              : "Search public sources or paste a known public email-format page."}
          </span>
        </div>
        <div className={styles.formatButtonRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onRefreshEmailFormat(company, null)}
            disabled={refreshingFormat}
          >
            {refreshingFormat ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <RefreshCw aria-hidden="true" />}
            <span>{hasEmailFormat ? "Refresh email format" : "Find email format"}</span>
          </button>
          <button type="button" className={styles.ghostButton} onClick={onToggleFormatSource}>
            Use specific source URL
          </button>
          {!hasEmailFormat && (
            <button type="button" className={styles.ghostButton} onClick={onToggleManualFormat}>
              Fix manually
            </button>
          )}
        </div>
        {showFormatSource && (
          <div className={styles.sourceRefreshRow}>
            <input
              className={styles.input}
              value={formatSourceUrl}
              onChange={(event) => onFormatSourceUrlChange(event.target.value)}
              placeholder="https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
              aria-label="Specific public email-format source URL"
            />
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => onRefreshEmailFormat(company, formatSourceUrl)}
              disabled={refreshingFormat || !formatSourceUrl.trim()}
            >
              Parse source
            </button>
          </div>
        )}
        {showManualFormat && (
          <div className={styles.manualFormatGrid}>
            <input
              className={styles.input}
              value={manualEmailDomain}
              onChange={(event) => onManualEmailDomainChange(event.target.value)}
              placeholder="amat.com"
              aria-label="Manual email domain"
            />
            <select
              className={styles.input}
              value={manualEmailPattern}
              onChange={(event) => onManualEmailPatternChange(event.target.value)}
              aria-label="Manual email pattern"
            >
              {EMAIL_PATTERN_OPTIONS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {pattern}
                </option>
              ))}
            </select>
            <select
              className={styles.input}
              value={manualConfidence}
              onChange={(event) => onManualConfidenceChange(event.target.value as ConfidenceLevel)}
              aria-label="Manual confidence"
            >
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onManualEmailFormat(company)}
              disabled={refreshingFormat || !manualEmailDomain.trim()}
            >
              Apply manual fix
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceItem({ label, sourceName, sourceUrl }: { label: string; sourceName: string; sourceUrl: string | null }) {
  return (
    <span className={styles.evidenceItem}>
      <span>{label}</span>
      {sourceUrl ? (
        <a href={sourceUrl} target={EXTERNAL_LINK_TARGET} rel={EXTERNAL_LINK_REL}>
          {sourceName} <ExternalLink aria-hidden="true" />
        </a>
      ) : (
        <span className={styles.evidenceSource}>{sourceName}</span>
      )}
    </span>
  );
}

function StatusCard({
  search,
  processing,
  onProcess,
  onCancel
}: {
  search: ProspectSearchNode;
  processing: boolean;
  onProcess: () => void;
  onCancel: () => void;
}) {
  const badge = statusBadge(search.status);
  const failed = search.status === "FAILED";
  const canceled = search.status === "CANCELED";
  const error = failed ? formatSearchError(search) : null;
  return (
    <div className={`card ${styles.statusCard}`}>
      <div className={styles.statusHead}>
        <BadgePill badge={badge} />
        <h2 className={styles.panelTitle}>{search.company?.name ?? search.requestedCompany}</h2>
      </div>
      {processing ? (
        <p className={styles.statusBody}>
          <LoaderCircle aria-hidden="true" className={styles.spin} /> Processing — this can take up to a minute while we resolve
          the company, search people, and infer the email domain and pattern.
        </p>
      ) : failed ? (
        <p className={styles.statusBody}>
          <span className={styles.errorCode}>{error?.code}</span> {error?.message}
        </p>
      ) : canceled ? (
        <p className={styles.statusBody}>This search was canceled. Create a new one to discover people.</p>
      ) : (
        <p className={styles.statusBody}>
          This search is still a draft. Run Process to resolve the company and discover up to {search.maxResults} people.
        </p>
      )}
      <div className={styles.statusActions}>
        {!canceled && (
          <button type="button" className={styles.primaryButton} onClick={onProcess} disabled={processing}>
            {processing ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
            {failed ? "Retry processing" : "Process search"}
          </button>
        )}
        {!canceled && !failed && (
          <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={processing}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function PeopleTable({
  people,
  loading,
  error,
  copiedId,
  onCopy
}: {
  people: PersonNode[];
  loading: boolean;
  error: string | null;
  copiedId: string | null;
  onCopy: (person: PersonNode) => void;
}) {
  if (loading) {
    return (
      <div className={styles.tableSkeleton}>
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className={styles.skeletonRow} />
        ))}
      </div>
    );
  }
  if (error) {
    return <p className={styles.errorText}>{error}</p>;
  }
  if (people.length === 0) {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title="No people in this view"
        body="Try a different position category, clear the filter, or process another search."
        compact
      />
    );
  }

  return (
    <div className={styles.table} role="table" aria-label="People">
      <div className={`${styles.row} ${styles.headRow}`} role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Title</span>
        <span role="columnheader">Location</span>
        <span role="columnheader">Inferred email</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className={styles.linkedinHead}>
          LinkedIn
        </span>
      </div>
      {people.map((person) => {
        const badge = emailStatusBadge(person.emailStatus);
        const copyable = isEmailCopyable(person);
        const copied = copiedId === person.id;
        return (
          <div className={styles.row} role="row" key={person.id}>
            <span className={styles.cellName} role="cell" data-label="Name">
              <span className={styles.personName}>{person.fullName}</span>
              <span className={styles.personConfidence}>{confidenceBadge(person.emailConfidence).label} confidence</span>
            </span>
            <span className={styles.cellTitle} role="cell" data-label="Title" title={person.currentTitle ?? undefined}>
              {person.currentTitle ?? "—"}
            </span>
            <span className={styles.cellLocation} role="cell" data-label="Location">
              <MapPin aria-hidden="true" /> {personLocation(person)}
            </span>
            <span className={styles.cellEmail} role="cell" data-label="Inferred email">
              {copyable ? (
                <>
                  <span className={styles.emailText} title={person.inferredEmail ?? undefined}>
                    {person.inferredEmail}
                  </span>
                  <button
                    type="button"
                    className={`${styles.copyButton} ${copied ? styles.copyButtonCopied : ""}`}
                    onClick={() => onCopy(person)}
                    aria-label={copied ? "Copied" : `Copy ${person.inferredEmail}`}
                    title={copied ? "Copied" : "Copy email"}
                  >
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                </>
              ) : (
                <span className={styles.emailUnavailable}>Unavailable</span>
              )}
            </span>
            <span className={styles.cellStatus} role="cell" data-label="Status">
              <BadgePill badge={badge} />
            </span>
            <span className={styles.cellLink} role="cell" data-label="LinkedIn">
              <a
                href={person.linkedinUrl}
                target={EXTERNAL_LINK_TARGET}
                rel={EXTERNAL_LINK_REL}
                className={styles.linkButton}
                aria-label={`Open ${person.fullName} on LinkedIn`}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NewSearchPanel({
  open,
  form,
  creating,
  onChange,
  onSubmit,
  onToggle,
  alwaysOpen = false
}: {
  open: boolean;
  form: CreateForm;
  creating: boolean;
  onChange: (form: CreateForm) => void;
  onSubmit: (event: FormEvent) => void;
  onToggle: () => void;
  alwaysOpen?: boolean;
}) {
  if (!open && !alwaysOpen) {
    return null;
  }
  return (
    <form className={`card ${styles.newSearchPanel}`} onSubmit={onSubmit}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>New prospect search</h2>
          <p className={styles.panelSubtitle}>Creates a draft. Process it to fetch people.</p>
        </div>
        {!alwaysOpen && (
          <button type="button" className={styles.ghostButton} onClick={onToggle} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Company name</span>
        <input
          className={styles.input}
          value={form.companyName}
          onChange={(event) => onChange({ ...form, companyName: event.target.value })}
          placeholder="Stripe"
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Job titles</span>
        <input
          className={styles.input}
          value={form.jobTitles}
          onChange={(event) => onChange({ ...form, jobTitles: event.target.value })}
          placeholder="Software Engineer, Recruiter"
        />
        <span className={styles.fieldHint}>Comma separated</span>
      </label>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Locations</span>
          <input
            className={styles.input}
            value={form.locations}
            onChange={(event) => onChange({ ...form, locations: event.target.value })}
            placeholder="United States"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldSmall}`}>
          <span className={styles.fieldLabel}>Max results</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            max={25}
            value={form.maxResults}
            onChange={(event) => onChange({ ...form, maxResults: event.target.value })}
          />
        </label>
      </div>
      <button type="submit" className={styles.primaryButton} disabled={creating}>
        {creating ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Plus aria-hidden="true" />}
        Create draft search
      </button>
    </form>
  );
}

function EmptyState({
  icon,
  title,
  body,
  compact = false
}: {
  icon: ReactNode;
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.emptyState} ${compact ? styles.emptyStateCompact : "card"}`}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
    </div>
  );
}

function DisabledState() {
  return (
    <div className={`card ${styles.disabledCard}`}>
      <span className={styles.disabledIcon} aria-hidden="true">
        <Ban />
      </span>
      <h2 className={styles.emptyTitle}>Prospect Graph is not enabled</h2>
      <p className={styles.emptyBody}>
        Enable <code className={styles.patternCode}>PROSPECT_GRAPH_ENABLED</code> locally to review company, position, and
        people results.
      </p>
    </div>
  );
}

function SearchesSkeleton() {
  return (
    <div className={styles.panelGrid}>
      <div className={`card ${styles.historyPanel}`}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={styles.skeletonCard} />
        ))}
      </div>
      <div className={styles.mainPanel}>
        <div className={`card ${styles.companyCard}`}>
          <div className={styles.skeletonLine} style={{ width: "45%" }} />
          <div className={styles.skeletonLine} style={{ width: "75%" }} />
        </div>
      </div>
    </div>
  );
}
