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
  Download,
  ExternalLink,
  FileSpreadsheet,
  Inbox,
  LoaderCircle,
  MapPin,
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
  CREATE_PROSPECT_IMPORT_MUTATION,
  CREATE_SEARCH_MUTATION,
  DELETE_COMPANY_MUTATION,
  DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
  PEOPLE_PAGE_SIZE,
  PEOPLE_QUERY,
  PREPARE_PROSPECT_EXPORT_MUTATION,
  PROCESS_SEARCH_MUTATION,
  PROSPECT_SEARCHES_QUERY,
  REVIEW_PROSPECT_SELECTION_MUTATION,
  REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
  SEARCHES_PAGE_SIZE,
  SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION,
  buildPeopleVariables,
  buildSearchesVariables,
  prospectGraphql,
  type CompanyDetail,
  type ConfidenceLevel,
  type Connection,
  type PersonNode,
  type PositionCategory,
  type PreparedProspectExport,
  type ProspectImportResult,
  type ProspectSelectionInput,
  type ProspectSelectionReview,
  type ProspectSearchNode
} from "@/components/prospects/prospect-graphql";
import {
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  PROSPECT_FINDER_SUBTITLE,
  PROSPECT_FINDER_TAGLINE,
  PROSPECT_FINDER_TITLE,
  PROSPECT_FINDER_UNAVAILABLE_BODY,
  PROSPECT_FINDER_UNAVAILABLE_TITLE,
  type Badge,
  type BadgeTone,
  confidenceBadge,
  buildProspectSelectionInput,
  createEmptyProspectSelection,
  emailStatusBadge,
  filterPeopleByText,
  formatDateTime,
  formatPageLabel,
  formatSearchError,
  formatShowingLabel,
  isEmailCopyable,
  getPageSelectionState,
  getProspectSelectionCount,
  isProspectSelected,
  personLocation,
  resolvePageCount,
  resolveProspectPageState,
  resolveSelectedSearchView,
  selectAllMatchingProspects,
  statusBadge,
  togglePageProspectSelection,
  toggleProspectSelection,
  type PageSelectionState,
  type ProspectSelectionState
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

type ActionNotice = {
  message: string;
  href?: string;
  label?: string;
};

type ReviewIntent = "download" | "import";

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
  // Search-history pagination state — fully independent from the people table.
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const historyAfterCursors = useRef<(string | null)[]>([null]);
  const searchesReq = useRef(0);

  // The selected search is tracked independently of the current history page so
  // paging the history table never blanks the company/people sections below.
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [selectedSearch, setSelectedSearch] = useState<ProspectSearchNode | null>(null);
  const selectedSearchIdRef = useRef<string | null>(null);

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
  const [selection, setSelection] = useState<ProspectSelectionState>(() => createEmptyProspectSelection());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent>("download");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [review, setReview] = useState<ProspectSelectionReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [preparingExport, setPreparingExport] = useState(false);
  const [creatingImport, setCreatingImport] = useState(false);

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
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const peopleReq = useRef(0);
  const companyReq = useRef(0);

  const selectedView = resolveSelectedSearchView(selectedSearch);
  const pageState = resolveProspectPageState({ disabled, loading: searchesLoading, searchCount: searchesTotal });

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
      selectedSearchIdRef.current = search.id;
      setSelectedSearchId(search.id);
      setSelectedSearch(search);
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
      setSelection(createEmptyProspectSelection());
      setReview(null);
      setReviewError(null);
      resetPeopleState();
      if (search.status === "READY" && search.company) {
        void loadCompany(search.company.id);
        void loadPeople({ companyId: search.company.id, category: null, pageIndex: 0, after: null });
      }
    },
    [loadCompany, loadPeople, resetPeopleState]
  );

  const loadSearches = useCallback(
    async (options: { pageIndex?: number; after?: string | null; autoSelect?: boolean; selectId?: string } = {}) => {
      const pageIndex = options.pageIndex ?? 0;
      const after = options.after ?? null;
      const req = ++searchesReq.current;
      setSearchesLoading(true);
      setSearchesError(null);
      const result = await prospectGraphql<{ prospectSearches: Connection<ProspectSearchNode> }>(
        PROSPECT_SEARCHES_QUERY,
        buildSearchesVariables({ after })
      );
      // Ignore a stale page response that a faster later request superseded.
      if (req !== searchesReq.current) {
        return;
      }
      if (result.disabled) {
        setDisabled(true);
        setSearchesLoading(false);
        return;
      }
      // Backend reachable and enabled — clear any stale server-rendered hint.
      setDisabled(false);
      if (result.error || !result.data) {
        setSearchesError(result.error ?? "Could not load searches.");
        setSearchesLoading(false);
        return;
      }
      const connection = result.data.prospectSearches;
      const nodes = connection.edges.map((edge) => edge.node);
      setSearches(nodes);
      setSearchesHasNext(connection.pageInfo.hasNextPage);
      setSearchesEndCursor(connection.pageInfo.endCursor);
      setSearchesTotal(connection.totalCount);
      setHistoryPageIndex(pageIndex);
      setSearchesLoading(false);

      // Keep the selected search's status/company fresh when it appears on the
      // freshly loaded page, without disturbing the selection otherwise.
      const currentSelectedId = selectedSearchIdRef.current;
      if (currentSelectedId) {
        const fresh = nodes.find((node) => node.id === currentSelectedId);
        if (fresh) {
          setSelectedSearch(fresh);
        }
      }

      if (options.selectId) {
        const node = nodes.find((item) => item.id === options.selectId);
        if (node) {
          selectSearch(node);
        }
      } else if (options.autoSelect && !currentSelectedId && nodes.length > 0) {
        const preferred = nodes.find((node) => node.status === "READY" && node.company) ?? nodes[0];
        selectSearch(preferred);
      }
    },
    [selectSearch]
  );

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
      // Reload the current history page (not page 1) so a refresh doesn't move
      // the user away from the page they were on.
      await loadSearches({ pageIndex: historyPageIndex, after: historyAfterCursors.current[historyPageIndex] ?? null });
      if (selectedSearch?.status === "READY" && selectedSearch.company) {
        peopleAfterCursors.current = [null];
        await loadCompany(selectedSearch.company.id);
        await loadPeople({ companyId: selectedSearch.company.id, category: activeCategory, pageIndex: 0, after: null });
      }
    })();
  }, [activeCategory, historyPageIndex, loadCompany, loadPeople, loadSearches, selectedSearch]);

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
      setActionNotice({ message: "Draft search created. Process it to fetch people." });
      // A new draft is the most recent search, so jump history back to page 1
      // and select it.
      historyAfterCursors.current = [null];
      await loadSearches({ pageIndex: 0, after: null, selectId: newId });
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
      const after = historyAfterCursors.current[historyPageIndex] ?? null;
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Processing failed. Try again with fewer results.");
        await loadSearches({ pageIndex: historyPageIndex, after });
        return;
      }
      // Reload the search's current page and re-select it so the updated status,
      // company, and people render in place.
      await loadSearches({ pageIndex: historyPageIndex, after, selectId: result.data.processProspectSearch.id });
    },
    [historyPageIndex, loadSearches]
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
      await loadSearches({ pageIndex: historyPageIndex, after: historyAfterCursors.current[historyPageIndex] ?? null });
    },
    [historyPageIndex, loadSearches]
  );

  const handleDeleteCompany = useCallback(
    async (target: CompanyDetail) => {
      const confirmed = window.confirm(
        `Delete ${target.name}? This removes the company, its inferred people, and related searches.`
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

      selectedSearchIdRef.current = null;
      setSelectedSearchId(null);
      setSelectedSearch(null);
      setCompany(null);
      setActiveCategory(null);
      setSelection(createEmptyProspectSelection());
      setReview(null);
      setReviewError(null);
      resetPeopleState();
      setActionNotice({ message: "Company deleted." });
      historyAfterCursors.current = [null];
      await loadSearches({ pageIndex: 0, after: null, autoSelect: true });
    },
    [loadSearches, resetPeopleState]
  );

  const reloadCompanyPeople = useCallback(
    async (updatedCompany: CompanyDetail) => {
      setCompany(updatedCompany);
      peopleAfterCursors.current = [null];
      await loadPeople({ companyId: updatedCompany.id, category: activeCategory, pageIndex: 0, after: null });
      await loadSearches({ pageIndex: historyPageIndex, after: historyAfterCursors.current[historyPageIndex] ?? null });
    },
    [activeCategory, historyPageIndex, loadPeople, loadSearches]
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
      setActionNotice({
        message:
          result.data.refreshCompanyEmailFormat.emailDomain && result.data.refreshCompanyEmailFormat.emailPattern
            ? "Email format refreshed from public evidence."
            : "No evidence-backed email format found yet."
      });
    },
    [reloadCompanyPeople]
  );

  const handleDiscoverEmailFormat = useCallback(
    async (target: CompanyDetail, force = false) => {
      setRefreshingFormatId(target.id);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ discoverCompanyEmailFormat: CompanyDetail }>(
        DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
        { companyId: target.id, force }
      );
      setRefreshingFormatId(null);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        // FORBIDDEN messages (rate limit / not configured) pass through safely.
        setActionError(result.error ?? "Could not find the email format with AI.");
        return;
      }
      await reloadCompanyPeople(result.data.discoverCompanyEmailFormat);
      setActionNotice({
        message:
          result.data.discoverCompanyEmailFormat.emailDomain && result.data.discoverCompanyEmailFormat.emailPattern
            ? "Email format found with AI web search."
            : "No public email-format evidence found yet. Paste a source URL or set it manually."
      });
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
      setActionNotice({ message: "Manual email format applied." });
    },
    [manualConfidence, manualEmailDomain, manualEmailPattern, reloadCompanyPeople]
  );

  const visiblePeople = useMemo(() => filterPeopleByText(people, peopleFilter), [people, peopleFilter]);
  const visibleCategories = useMemo(
    () => (company ? company.positions.filter((position) => position.peopleCount > 0) : []),
    [company]
  );
  const peopleOffset = peoplePageIndex * PEOPLE_PAGE_SIZE;
  const peoplePageCount = resolvePageCount(peopleTotal, PEOPLE_PAGE_SIZE);
  const historyOffset = historyPageIndex * SEARCHES_PAGE_SIZE;
  const historyPageCount = resolvePageCount(searchesTotal, SEARCHES_PAGE_SIZE);
  const selectionScope = useMemo(
    () => ({ companyId: company?.id ?? "", positionCategory: activeCategory }),
    [activeCategory, company?.id]
  );
  const selectionScopeTotal = useMemo(() => {
    if (!company || selection.mode !== "allMatching" || selection.companyId !== company.id) {
      return 0;
    }
    if (!selection.positionCategory) {
      return company.peopleCount;
    }
    return company.positions.find((position) => position.category === selection.positionCategory)?.peopleCount ?? 0;
  }, [company, selection]);
  const selectedCount = getProspectSelectionCount(selection, selectionScopeTotal);
  const selectedPageIds = useMemo(() => visiblePeople.map((person) => person.id), [visiblePeople]);
  const pageSelectionState = getPageSelectionState(selection, selectedPageIds, selectionScope);
  const selectedPageCount = selectedPageIds.filter((id) => isProspectSelected(selection, id, selectionScope)).length;
  const canSelectAllMatching = Boolean(
    company &&
      selection.mode !== "allMatching" &&
      peopleTotal > selectedPageIds.length &&
      selectedPageIds.length > 0 &&
      pageSelectionState === "checked"
  );

  const buildCurrentSelectionInput = useCallback((): ProspectSelectionInput | null => {
    if (!company) {
      return null;
    }
    return buildProspectSelectionInput(selection, company.id);
  }, [company, selection]);

  const clearSelection = useCallback(() => {
    setSelection(createEmptyProspectSelection());
    setReview(null);
    setReviewError(null);
  }, []);

  const handleTogglePersonSelection = useCallback(
    (personId: string) => {
      setSelection((current) => toggleProspectSelection(current, personId, selectionScope));
    },
    [selectionScope]
  );

  const handleTogglePageSelection = useCallback(() => {
    setSelection((current) => togglePageProspectSelection(current, selectedPageIds, selectionScope));
  }, [selectedPageIds, selectionScope]);

  const handleSelectAllMatching = useCallback(() => {
    if (!company) {
      return;
    }
    setSelection(selectAllMatchingProspects({ companyId: company.id, positionCategory: activeCategory }));
  }, [activeCategory, company]);

  const openReviewDialog = useCallback(
    async (intent: ReviewIntent) => {
      const input = buildCurrentSelectionInput();
      if (!input) {
        setActionError("Select at least one prospect first.");
        return;
      }
      setReviewIntent(intent);
      setReviewOpen(true);
      setReviewLoading(true);
      setReview(null);
      setReviewError(null);
      const result = await prospectGraphql<{ reviewProspectSelection: ProspectSelectionReview }>(
        REVIEW_PROSPECT_SELECTION_MUTATION,
        { input }
      );
      setReviewLoading(false);
      if (result.disabled) {
        setDisabled(true);
        setReviewOpen(false);
        return;
      }
      if (result.error || !result.data) {
        setReviewError(result.error ?? "Could not review the selected prospects.");
        return;
      }
      setReview(result.data.reviewProspectSelection);
    },
    [buildCurrentSelectionInput]
  );

  const triggerDownload = useCallback((downloadUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const handleDownloadSelected = useCallback(async () => {
    const input = buildCurrentSelectionInput();
    if (!input || preparingExport || creatingImport) {
      return;
    }
    setPreparingExport(true);
    setReviewError(null);
    const result = await prospectGraphql<{ prepareProspectExport: PreparedProspectExport }>(
      PREPARE_PROSPECT_EXPORT_MUTATION,
      { input }
    );
    setPreparingExport(false);
    if (result.disabled) {
      setDisabled(true);
      setReviewOpen(false);
      return;
    }
    if (result.error || !result.data) {
      setReviewError(result.error ?? "Could not prepare the Excel file.");
      return;
    }
    const exportResult = result.data.prepareProspectExport;
    setReview(exportResult.review);
    setReviewOpen(false);
    triggerDownload(exportResult.downloadUrl, exportResult.fileName);
    setActionNotice({ message: `${exportResult.review.exportableCount} prospects are downloading as an Excel file.` });
  }, [buildCurrentSelectionInput, creatingImport, preparingExport, triggerDownload]);

  const handleCreateImport = useCallback(async () => {
    const input = buildCurrentSelectionInput();
    if (!input || preparingExport || creatingImport) {
      return;
    }
    setCreatingImport(true);
    setReviewError(null);
    const result = await prospectGraphql<{ createProspectImport: ProspectImportResult }>(
      CREATE_PROSPECT_IMPORT_MUTATION,
      { input }
    );
    setCreatingImport(false);
    if (result.disabled) {
      setDisabled(true);
      setReviewOpen(false);
      return;
    }
    if (result.error || !result.data) {
      setReviewError(result.error ?? "Could not create the import.");
      return;
    }
    const importResult = result.data.createProspectImport;
    setReview(importResult.review);
    setReviewOpen(false);
    clearSelection();
    setActionNotice({
      message: `${importResult.review.exportableCount} prospects were added to Imports.`,
      href: "/imports",
      label: "View import"
    });
  }, [buildCurrentSelectionInput, clearSelection, creatingImport, preparingExport]);

  // ---- Render -------------------------------------------------------------

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>
            <Users aria-hidden="true" /> {PROSPECT_FINDER_TAGLINE}
          </p>
          <h1>{PROSPECT_FINDER_TITLE}</h1>
          <p className={styles.subtitle}>{PROSPECT_FINDER_SUBTITLE}</p>
        </div>
        {!disabled && (
          <div className={styles.headerActions}>
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
            <button type="button" className={styles.primaryButton} onClick={() => setShowNewSearch(true)}>
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
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {actionNotice && (
        <div className={styles.inlineAlert} role="status">
          <Sparkles aria-hidden="true" />
          <span>
            {actionNotice.message}
            {actionNotice.href && actionNotice.label ? (
              <>
                {" "}
                <a href={actionNotice.href} className={styles.inlineAlertLink}>
                  {actionNotice.label}
                </a>
              </>
            ) : null}
          </span>
          <button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {pageState === "disabled" && <DisabledState />}

      {pageState === "loading" && <SearchesSkeleton />}

      {pageState === "empty" && (
        <EmptyState
          icon={<Inbox aria-hidden="true" />}
          title="No searches yet"
          body="Create your first search to discover people at a company and review their inferred work emails."
          action={
            <button type="button" className={styles.primaryButton} onClick={() => setShowNewSearch(true)}>
              <Plus aria-hidden="true" />
              <span>New search</span>
            </button>
          }
        />
      )}

      {pageState === "ready" && (
        <>
          <SummaryCards search={selectedSearch} company={company} view={selectedView} />

          <SearchHistoryTable
            searches={searches}
            total={searchesTotal}
            selectedId={selectedSearchId}
            loading={searchesLoading}
            error={searchesError}
            pageIndex={historyPageIndex}
            pageCount={historyPageCount}
            offset={historyOffset}
            hasNext={searchesHasNext}
            onSelect={selectSearch}
            onPrev={handleHistoryPrev}
            onNext={handleHistoryNext}
          />

          {selectedView === "none" && (
            <EmptyState
              icon={<Building2 aria-hidden="true" />}
              title="Select a search"
              body="Choose a search above to review its company, role groups, and people."
            />
          )}

          {(selectedView === "processing" || selectedView === "canceled" || selectedView === "failed") &&
            selectedSearch && (
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
                onDiscoverEmailFormat={handleDiscoverEmailFormat}
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

                  <div className={styles.categoryRail} role="tablist" aria-label="Role groups">
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
                  </div>

                  {selectedCount > 0 && (
                    <BulkSelectionToolbar
                      selectedCount={selectedCount}
                      preparingExport={preparingExport}
                      creatingImport={creatingImport}
                      onDownload={() => openReviewDialog("download")}
                      onImport={() => openReviewDialog("import")}
                      onClear={clearSelection}
                    />
                  )}

                  {canSelectAllMatching && (
                    <SelectAllMatchingBanner
                      pageCount={selectedPageCount}
                      totalCount={peopleTotal}
                      categoryName={
                        activeCategory
                          ? company.positions.find((position) => position.category === activeCategory)?.displayName ?? "this role group"
                          : null
                      }
                      onSelectAll={handleSelectAllMatching}
                    />
                  )}

                  <div className={styles.peopleTableShell}>
                    <PeopleTable
                      people={visiblePeople}
                      loading={peopleLoading}
                      error={peopleError}
                      copiedId={copiedId}
                      pageSelectionState={pageSelectionState}
                      selectionScope={selectionScope}
                      selection={selection}
                      onTogglePage={handleTogglePageSelection}
                      onTogglePerson={handleTogglePersonSelection}
                      onCopy={handleCopyEmail}
                    />
                  </div>

                  <div className={styles.paginationRow}>
                    <span className={styles.peopleShowing}>
                      {formatShowingLabel({ offset: peopleOffset, pageCount: people.length, totalCount: peopleTotal })}
                    </span>
                    <div className={styles.pager}>
                      <button
                        type="button"
                        className={styles.pagerButton}
                        onClick={handlePeoplePrev}
                        disabled={peoplePageIndex === 0 || peopleLoading}
                        aria-label="Previous page"
                        title="Previous page"
                      >
                        <ChevronLeft aria-hidden="true" />
                      </button>
                      <span className={styles.pageInfo}>
                        {formatPageLabel({ pageIndex: peoplePageIndex, pageCount: peoplePageCount })}
                      </span>
                      <button
                        type="button"
                        className={styles.pagerButton}
                        onClick={handlePeopleNext}
                        disabled={!peopleHasNext || peopleLoading}
                        aria-label="Next page"
                        title="Next page"
                      >
                        <ChevronRight aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <NewSearchModal
        open={showNewSearch}
        form={form}
        creating={creating}
        onChange={setForm}
        onSubmit={handleCreate}
        onClose={() => setShowNewSearch(false)}
      />
      <ProspectReviewDialog
        open={reviewOpen}
        intent={reviewIntent}
        review={review}
        loading={reviewLoading}
        error={reviewError}
        preparingExport={preparingExport}
        creatingImport={creatingImport}
        onClose={() => {
          if (!preparingExport && !creatingImport) {
            setReviewOpen(false);
          }
        }}
        onDownload={handleDownloadSelected}
        onImport={handleCreateImport}
      />
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
          <AtSign aria-hidden="true" /> Email format
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
  onDiscoverEmailFormat,
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
  onDiscoverEmailFormat: (company: CompanyDetail, force?: boolean) => void;
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
          <span className={styles.metaHint}>
            No email format found yet. Use AI web search, paste a public source URL, or set it manually.
          </span>
        )}
        {company.emailFormatReason && (
          <span className={styles.metaHint} title="Why this format was selected">
            {company.emailFormatReason}
          </span>
        )}
      </div>
      <div className={styles.formatActions}>
        <div className={styles.formatActionText}>
          <span className={styles.metaLabel}>Email format discovery</span>
          <span className={styles.metaHint}>
            {hasEmailFormat
              ? "Email format found from public evidence. Generated emails are inferred until verified."
              : "Find the format with AI web search, paste a known public email-format page, or set it manually."}
          </span>
        </div>
        <div className={styles.formatButtonRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onDiscoverEmailFormat(company, hasEmailFormat)}
            disabled={refreshingFormat}
          >
            {refreshingFormat ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Sparkles aria-hidden="true" />}
            <span>{hasEmailFormat ? "Refresh with AI" : "Find with AI"}</span>
          </button>
          <button type="button" className={styles.ghostButton} onClick={onToggleFormatSource}>
            Use source URL
          </button>
          <button type="button" className={styles.ghostButton} onClick={onToggleManualFormat}>
            Fix manually
          </button>
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

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.selectionCheckbox}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
    />
  );
}

function BulkSelectionToolbar({
  selectedCount,
  preparingExport,
  creatingImport,
  onDownload,
  onImport,
  onClear
}: {
  selectedCount: number;
  preparingExport: boolean;
  creatingImport: boolean;
  onDownload: () => void;
  onImport: () => void;
  onClear: () => void;
}) {
  const busy = preparingExport || creatingImport;
  return (
    <div className={styles.bulkToolbar}>
      <strong>{selectedCount} selected</strong>
      <div className={styles.bulkActions}>
        <button type="button" className={styles.secondaryButton} onClick={onDownload} disabled={busy}>
          <Download aria-hidden="true" />
          <span>Download Excel</span>
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onImport} disabled={busy}>
          <FileSpreadsheet aria-hidden="true" />
          <span>Add to Imports</span>
        </button>
        <button type="button" className={styles.ghostButton} onClick={onClear} disabled={busy}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

function SelectAllMatchingBanner({
  pageCount,
  totalCount,
  categoryName,
  onSelectAll
}: {
  pageCount: number;
  totalCount: number;
  categoryName: string | null;
  onSelectAll: () => void;
}) {
  return (
    <div className={styles.selectAllBanner} role="status">
      <span>All {pageCount} people on this page are selected.</span>
      <button type="button" onClick={onSelectAll}>
        {categoryName
          ? `Select all ${totalCount} ${categoryName} prospects.`
          : `Select all ${totalCount} people in this search.`}
      </button>
    </div>
  );
}

function PeopleTable({
  people,
  loading,
  error,
  copiedId,
  pageSelectionState,
  selectionScope,
  selection,
  onTogglePage,
  onTogglePerson,
  onCopy
}: {
  people: PersonNode[];
  loading: boolean;
  error: string | null;
  copiedId: string | null;
  pageSelectionState: PageSelectionState;
  selectionScope: { companyId: string; positionCategory: PositionCategory | null };
  selection: ProspectSelectionState;
  onTogglePage: () => void;
  onTogglePerson: (personId: string) => void;
  onCopy: (person: PersonNode) => void;
}) {
  if (loading) {
    return (
      <div className={styles.table} role="table" aria-label="People">
        <div className={`${styles.row} ${styles.headRow}`} role="row">
          <span role="columnheader" aria-label="Select page" />
          <span role="columnheader">Person</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Location</span>
          <span role="columnheader">Inferred email</span>
          <span role="columnheader">Confidence</span>
          <span role="columnheader" className={styles.linkedinHead}>
            LinkedIn
          </span>
        </div>
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className={styles.row} role="row" aria-hidden="true">
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
            <span className={styles.skeletonCell} />
          </div>
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
        title="No people found for this role group"
        body="Try a different role group, clear the filter, or run another search."
        compact
      />
    );
  }

  return (
    <div className={styles.table} role="table" aria-label="People">
      <div className={`${styles.row} ${styles.headRow}`} role="row">
        <span role="columnheader" className={styles.cellSelect}>
          <SelectionCheckbox
            checked={pageSelectionState === "checked"}
            indeterminate={pageSelectionState === "indeterminate"}
            disabled={people.length === 0}
            label="Select people on this page"
            onChange={onTogglePage}
          />
        </span>
        <span role="columnheader">Person</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Location</span>
        <span role="columnheader">Inferred email</span>
        <span role="columnheader">Confidence</span>
        <span role="columnheader" className={styles.linkedinHead}>
          LinkedIn
        </span>
      </div>
      {people.map((person) => {
        const badge = emailStatusBadge(person.emailStatus);
        const copyable = isEmailCopyable(person);
        const copied = copiedId === person.id;
        const selected = isProspectSelected(selection, person.id, selectionScope);
        return (
          <div className={styles.row} role="row" key={person.id}>
            <span className={styles.cellSelect} role="cell" data-label="Select">
              <SelectionCheckbox
                checked={selected}
                label={`Select ${person.fullName}`}
                onChange={() => onTogglePerson(person.id)}
              />
            </span>
            <span className={styles.cellName} role="cell" data-label="Person">
              <span className={styles.personName}>{person.fullName}</span>
              <span className={styles.personConfidence}>{confidenceBadge(person.emailConfidence).label} confidence</span>
            </span>
            <span className={styles.cellTitle} role="cell" data-label="Role" title={person.currentTitle ?? undefined}>
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
            <span className={styles.cellStatus} role="cell" data-label="Confidence">
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

function ProspectReviewDialog({
  open,
  intent,
  review,
  loading,
  error,
  preparingExport,
  creatingImport,
  onClose,
  onDownload,
  onImport
}: {
  open: boolean;
  intent: ReviewIntent;
  review: ProspectSelectionReview | null;
  loading: boolean;
  error: string | null;
  preparingExport: boolean;
  creatingImport: boolean;
  onClose: () => void;
  onDownload: () => void;
  onImport: () => void;
}) {
  if (!open) {
    return null;
  }

  const exportableCount = review?.exportableCount ?? 0;
  const busy = loading || preparingExport || creatingImport;
  const title = intent === "download" ? "Review Excel export" : "Review import";

  return (
    <div className={styles.modalOverlay} role="presentation">
      <div className={`card ${styles.modalCard} ${styles.reviewCard}`} role="dialog" aria-modal="true" aria-labelledby="prospect-review-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="prospect-review-title" className={styles.panelTitle}>
              {title}
            </h2>
            <p className={styles.panelSubtitle}>Suppressed records and records without usable email addresses will be skipped.</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close" disabled={busy}>
            <X aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className={styles.reviewLoading}>
            <LoaderCircle aria-hidden="true" className={styles.spin} />
            <span>Reviewing selected prospects…</span>
          </div>
        ) : error ? (
          <p className={styles.errorText}>{error}</p>
        ) : review ? (
          <>
            <dl className={styles.reviewGrid}>
              <div>
                <dt>Selected</dt>
                <dd>{review.selectedCount}</dd>
              </div>
              <div>
                <dt>Exportable</dt>
                <dd>{review.exportableCount}</dd>
              </div>
              <div>
                <dt>Unavailable email</dt>
                <dd>{review.unavailableEmailCount}</dd>
              </div>
              <div>
                <dt>Suppressed</dt>
                <dd>{review.suppressedCount}</dd>
              </div>
              {review.duplicateEmailCount > 0 && (
                <div>
                  <dt>Duplicate email</dt>
                  <dd>{review.duplicateEmailCount}</dd>
                </div>
              )}
            </dl>
            <p className={styles.reviewNote}>Generated email addresses remain inferred until verified.</p>
          </>
        ) : null}

        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onDownload} disabled={busy || exportableCount <= 0}>
            {preparingExport ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Download aria-hidden="true" />}
            <span>{preparingExport ? "Preparing Excel file…" : `Download ${exportableCount} records`}</span>
          </button>
          <button type="button" className={styles.primaryButton} onClick={onImport} disabled={busy || exportableCount <= 0}>
            {creatingImport ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <FileSpreadsheet aria-hidden="true" />}
            <span>{creatingImport ? "Creating import…" : `Add ${exportableCount} records to Imports`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchHistoryTable({
  searches,
  total,
  selectedId,
  loading,
  error,
  pageIndex,
  pageCount,
  offset,
  hasNext,
  onSelect,
  onPrev,
  onNext
}: {
  searches: ProspectSearchNode[];
  total: number;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  pageIndex: number;
  pageCount: number;
  offset: number;
  hasNext: boolean;
  onSelect: (search: ProspectSearchNode) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <section className={`card ${styles.historyPanel}`} aria-label="Search history">
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
            {searches.map((search) => {
              const active = search.id === selectedId;
              const roles = search.requestedTitles;
              const location = search.requestedLocations[0] ?? null;
              const domain = search.company?.officialWebsiteDomain ?? search.company?.officialDomain ?? null;
              return (
                <button
                  key={search.id}
                  type="button"
                  className={`${styles.historyRow} ${active ? styles.historyRowActive : ""}`}
                  onClick={() => onSelect(search)}
                  aria-current={active ? "true" : undefined}
                >
                  <span className={styles.historyCompanyCell} data-label="Company">
                    <span className={styles.historyCompanyName}>{search.company?.name ?? search.requestedCompany}</span>
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
                  <span data-label="Status">
                    <BadgePill badge={statusBadge(search.status)} />
                  </span>
                  <span className={styles.historyCreatedCell} data-label="Created">
                    {formatDateTime(search.createdAt)}
                  </span>
                  <span className={styles.historyViewCell} aria-hidden="true">
                    <ChevronRight />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.paginationRow}>
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

function NewSearchModal({
  open,
  form,
  creating,
  onChange,
  onSubmit,
  onClose
}: {
  open: boolean;
  form: CreateForm;
  creating: boolean;
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
          <button type="button" className={styles.ghostButton} onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
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
          <label className={styles.field}>
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

function EmptyState({
  icon,
  title,
  body,
  compact = false,
  action
}: {
  icon: ReactNode;
  title: string;
  body: string;
  compact?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`${styles.emptyState} ${compact ? styles.emptyStateCompact : "card"}`}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

function DisabledState() {
  return (
    <div className={`card ${styles.disabledCard}`}>
      <span className={styles.disabledIcon} aria-hidden="true">
        <Ban />
      </span>
      <h2 className={styles.emptyTitle}>{PROSPECT_FINDER_UNAVAILABLE_TITLE}</h2>
      <p className={styles.emptyBody}>{PROSPECT_FINDER_UNAVAILABLE_BODY}</p>
    </div>
  );
}

function SearchesSkeleton() {
  return (
    <>
      <div className={styles.summaryGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={`card ${styles.summaryCard}`}>
            <div className={styles.skeletonLine} style={{ width: "40%" }} />
            <div className={styles.skeletonLine} style={{ width: "70%" }} />
          </div>
        ))}
      </div>
      <div className={`card ${styles.peopleSection}`}>
        <div className={styles.tableSkeleton}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className={styles.skeletonRow} />
          ))}
        </div>
      </div>
    </>
  );
}
