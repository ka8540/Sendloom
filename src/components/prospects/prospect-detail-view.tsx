"use client";

// Discover DETAIL page (/prospects/[searchId]). The dedicated workspace for one
// user-owned search: summary cards, company + email-format details and evidence,
// Add 10 More, role filters, the People table with selection/export/import, and
// pagination. It loads entirely from the route searchId (never from list-page
// React state), so it works on direct load, refresh, or a new tab.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LoaderCircle,
  MapPin,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CircularCloseButton } from "@/components/circular-close-button";

import {
  ADD_MORE_DISCOVER_PEOPLE_MUTATION,
  CANCEL_SEARCH_MUTATION,
  COMPANY_DETAIL_QUERY,
  CREATE_PROSPECT_IMPORT_MUTATION,
  DELETE_COMPANY_MUTATION,
  DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
  DISCOVER_QUOTA_QUERY,
  PEOPLE_PAGE_SIZE,
  PEOPLE_QUERY,
  PREPARE_PROSPECT_EXPORT_MUTATION,
  PROCESS_SEARCH_MUTATION,
  PROSPECT_SEARCH_BY_ID_QUERY,
  REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
  REVIEW_PROSPECT_SELECTION_MUTATION,
  SEARCH_COMPANY_ROLE_MUTATION,
  SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION,
  buildPeopleVariables,
  prospectGraphql,
  type CompanyDetail,
  type ConfidenceLevel,
  type Connection,
  type DiscoverQuota,
  type DiscoverSearchExpansion,
  type PersonNode,
  type PositionCategory,
  type PreparedProspectExport,
  type ProspectImportResult,
  type ProspectSelectionInput,
  type ProspectSelectionReview,
  type ProspectSearchNode
} from "@/components/prospects/prospect-graphql";
import {
  ADD_MORE_CANCEL_LABEL,
  ADD_MORE_CHOOSE_ROLE_HINT,
  ADD_MORE_CONFIRM_LABEL,
  ADD_MORE_DIALOG_BODY,
  ADD_MORE_DIALOG_TITLE,
  ADD_MORE_LOADING_LABEL,
  ADD_MORE_PEOPLE_LABEL,
  ALL_LOCATIONS_LABEL,
  ALL_ROLES_LABEL,
  CLEAR_FILTERS_LABEL,
  COMPANY_SEARCH_BUTTON_LABEL,
  COMPANY_SEARCH_CLOSE_LABEL,
  COMPANY_SEARCH_HELPER,
  COMPANY_SEARCH_LOADING_LABEL,
  COMPANY_SEARCH_LOCATION_LABEL,
  COMPANY_SEARCH_LOCATION_PLACEHOLDER,
  COMPANY_SEARCH_ROLE_LABEL,
  COMPANY_SEARCH_ROLE_PLACEHOLDER,
  COMPANY_SEARCH_SUBTITLE,
  COMPANY_SEARCH_TITLE,
  COMPANY_SEARCH_TRIGGER_LABEL,
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  FILTERED_PEOPLE_EMPTY_BODY,
  FILTERED_PEOPLE_EMPTY_TITLE,
  INFERRED_EMAIL_NOTICE,
  addMoreDisabledReason,
  addMoreSearchLabel,
  buildLocationFilterOptions,
  buildProspectSelectionInput,
  buildQualitySegments,
  companySearchDisabledReason,
  companySearchSuccessMessage,
  confidenceBadge,
  createEmptyProspectSelection,
  deriveDiscoverQualitySummary,
  describeQualitySummary,
  emailConfidenceFromUsableRate,
  emailFormatEvidenceSummary,
  emailStatusBadge,
  filterPeopleByText,
  formatDateTime,
  formatPageLabel,
  formatQuotaReset,
  formatSearchError,
  formatShowingLabel,
  getPageSelectionState,
  getProspectSelectionCount,
  groupedRoleLabels,
  isEmailCopyable,
  isProcessQuotaBlocked,
  isProspectSelected,
  personLocation,
  qualityPercent,
  resolveAddMoreTarget,
  resolveNextEmailFormatMode,
  resolvePageCount,
  resolveSelectedSearchView,
  selectAllMatchingProspects,
  shouldShowAddMore,
  statusBadge,
  togglePageProspectSelection,
  toggleProspectSelection,
  type AddMoreCandidateSearch,
  type AddMoreTarget,
  type EmailFormatActionMode,
  type LocationFilterOption,
  type PageSelectionState,
  type ProspectSelectionState,
  type QualitySegmentTone
} from "@/components/prospects/prospect-view";
import {
  resolveCompanyRoleSearchAction,
  validateCompanyRoleSearchInput
} from "@/services/prospects/discover-company-role-search";
import {
  BadgePill,
  DisabledState,
  EmptyState,
  EMAIL_PATTERN_OPTIONS,
  QuotaIndicator,
  type ActionNotice,
  type ReviewIntent
} from "@/components/prospects/prospects-shared";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/prospects/prospects-dashboard.module.css";

const DELETE_COMPANY_ERROR = "This company could not be deleted. Please try again.";
const DEFAULT_MANUAL_PATTERN = "first.last";

// Disclosure pair id: the premium header trigger points aria-controls here and
// the collapsible "Search this company" panel carries it.
const COMPANY_SEARCH_PANEL_ID = "discover-company-search-panel";

// People filter <select> sentinels. Both dropdowns reserve a non-colliding
// value for their "show everything" option: role categories are uppercase enum
// tokens and location keys are normalized/blank ("" = "Any location"), so these
// double-underscore values can never match a real option.
const ALL_ROLES_VALUE = "__all_roles__";
const ALL_LOCATIONS_VALUE = "__all_locations__";

type DetailStage = "ready" | "draft" | "processing" | "failed";

function resolveDetailStage(search: ProspectSearchNode | null): DetailStage | null {
  if (!search) {
    return null;
  }
  if (search.status === "READY") {
    return "ready";
  }
  if (search.status === "DRAFT") {
    return "draft";
  }
  if (search.status === "FAILED") {
    return "failed";
  }
  if (search.status === "CANCELED") {
    return null;
  }
  return "processing";
}

export function ProspectDetailView({ searchId, featureEnabled }: { searchId: string; featureEnabled: boolean }) {
  const router = useRouter();
  const [disabled, setDisabled] = useState(!featureEnabled);

  const [search, setSearch] = useState<ProspectSearchNode | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const searchReq = useRef(0);

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const companyReq = useRef(0);

  const [activeCategory, setActiveCategory] = useState<PositionCategory | null>(null);
  // Canonical location-chip key ("" = the "Any location" group); null = all.
  const [activeLocation, setActiveLocation] = useState<string | null>(null);

  const [people, setPeople] = useState<PersonNode[]>([]);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleHasNext, setPeopleHasNext] = useState(false);
  const [peopleEndCursor, setPeopleEndCursor] = useState<string | null>(null);
  const [peoplePageIndex, setPeoplePageIndex] = useState(0);
  const peopleAfterCursors = useRef<(string | null)[]>([null]);
  const peopleReq = useRef(0);

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

  const [quota, setQuota] = useState<DiscoverQuota | null>(null);
  const [processing, setProcessing] = useState(false);
  // "Search this company" (same company, new role/location) form state. The
  // form lives in a collapsible panel that is CLOSED by default — only the
  // premium header trigger is visible until the user asks for the form.
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const companySearchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [companyRoleTitle, setCompanyRoleTitle] = useState("");
  const [companyRoleLocation, setCompanyRoleLocation] = useState("");
  const [companySearching, setCompanySearching] = useState(false);
  const [companySearchNotice, setCompanySearchNotice] = useState<{ tone: "info" | "error"; message: string } | null>(
    null
  );
  const [expanding, setExpanding] = useState(false);
  const [showAddMoreDialog, setShowAddMoreDialog] = useState(false);
  const [sessionExhausted, setSessionExhausted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [companyPendingDeletion, setCompanyPendingDeletion] = useState<CompanyDetail | null>(null);
  const [deleteCompanyError, setDeleteCompanyError] = useState<string | null>(null);
  const [refreshingFormat, setRefreshingFormat] = useState(false);
  // ONE exclusive correction mode drives the email-format editors. The editors
  // render inside a single stable container, so repeated clicks can only swap
  // the active editor — never append another form.
  const [formatActionMode, setFormatActionMode] = useState<EmailFormatActionMode>("none");
  const [formatSourceUrl, setFormatSourceUrl] = useState("");
  const [manualEmailDomain, setManualEmailDomain] = useState("");
  const [manualEmailPattern, setManualEmailPattern] = useState(DEFAULT_MANUAL_PATTERN);
  const [manualConfidence, setManualConfidence] = useState<ConfidenceLevel>("HIGH");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  const selectedView = resolveSelectedSearchView(search);

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
    async (args: {
      companyId: string;
      category: PositionCategory | null;
      location: string | null;
      pageIndex: number;
      after: string | null;
    }) => {
      const req = ++peopleReq.current;
      setPeopleLoading(true);
      setPeopleError(null);
      const result = await prospectGraphql<{ people: Connection<PersonNode> }>(
        PEOPLE_QUERY,
        buildPeopleVariables({
          companyId: args.companyId,
          category: args.category,
          location: args.location,
          after: args.after
        })
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

  // Load the search by route id, then its company + people when it is READY.
  // Preserves the active category/location on a silent refresh (keeps the
  // current view).
  const loadDetail = useCallback(
    async (options: { category?: PositionCategory | null; location?: string | null } = {}) => {
      const category = options.category ?? null;
      const location = options.location ?? null;
      const req = ++searchReq.current;
      setSearchLoading(true);
      const result = await prospectGraphql<{ prospectSearch: ProspectSearchNode | null }>(PROSPECT_SEARCH_BY_ID_QUERY, {
        id: searchId
      });
      if (req !== searchReq.current) {
        return;
      }
      if (result.disabled) {
        setDisabled(true);
        setSearchLoading(false);
        return;
      }
      setDisabled(false);
      const node = result.data?.prospectSearch ?? null;
      if (!node) {
        setNotFound(true);
        setSearch(null);
        setSearchLoading(false);
        return;
      }
      setNotFound(false);
      setSearch(node);
      setSearchLoading(false);
      if (node.status === "READY" && node.company) {
        peopleAfterCursors.current = [null];
        await loadCompany(node.company.id);
        await loadPeople({ companyId: node.company.id, category, location, pageIndex: 0, after: null });
      } else {
        setCompany(null);
        resetPeopleState();
      }
    },
    [loadCompany, loadPeople, resetPeopleState, searchId]
  );

  useEffect(() => {
    // Never carry another company's correction editors, drafts, selection, or
    // notices into this search — every route change starts from a clean slate.
    setFormatActionMode("none");
    setFormatSourceUrl("");
    setManualEmailDomain("");
    setManualEmailPattern(DEFAULT_MANUAL_PATTERN);
    setManualConfidence("HIGH");
    setActionError(null);
    setActionNotice(null);
    setSelection(createEmptyProspectSelection());
    setActiveLocation(null);
    setCompanySearchOpen(false);
    setCompanyRoleTitle("");
    setCompanyRoleLocation("");
    setCompanySearchNotice(null);
    void loadDetail();
    void loadQuota();
    // Reload whenever the route's searchId changes (e.g. client-side nav).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  // Auto-open the detail guide once per stage when the page is settled.
  useEffect(() => {
    if (!discoverManual || manualOpen || searchLoading || notFound || reviewOpen || showAddMoreDialog || processing) {
      return;
    }
    const stage = resolveDetailStage(search);
    if (!stage || autoTourStagesRef.current.has(stage)) {
      return;
    }
    autoTourStagesRef.current.add(stage);
    if (isStageComplete(stage)) {
      return;
    }
    openManualStage(stage);
  }, [
    discoverManual,
    manualOpen,
    searchLoading,
    notFound,
    reviewOpen,
    showAddMoreDialog,
    processing,
    search,
    openManualStage,
    isStageComplete
  ]);

  const handleSelectCategory = useCallback(
    (category: PositionCategory | null) => {
      if (!company) {
        return;
      }
      setActiveCategory(category);
      peopleAfterCursors.current = [null];
      setPeopleFilter("");
      void loadPeople({ companyId: company.id, category, location: activeLocation, pageIndex: 0, after: null });
    },
    [activeLocation, company, loadPeople]
  );

  // Role and location filters combine: selecting a location keeps the active
  // role tab, and vice versa.
  const handleSelectLocation = useCallback(
    (location: string | null) => {
      if (!company) {
        return;
      }
      setActiveLocation(location);
      peopleAfterCursors.current = [null];
      setPeopleFilter("");
      void loadPeople({ companyId: company.id, category: activeCategory, location, pageIndex: 0, after: null });
    },
    [activeCategory, company, loadPeople]
  );

  const handleClearFilters = useCallback(() => {
    if (!company) {
      return;
    }
    setActiveCategory(null);
    setActiveLocation(null);
    setPeopleFilter("");
    peopleAfterCursors.current = [null];
    void loadPeople({ companyId: company.id, category: null, location: null, pageIndex: 0, after: null });
  }, [company, loadPeople]);

  const handlePeopleNext = useCallback(() => {
    if (!company || !peopleHasNext) {
      return;
    }
    const after = peopleEndCursor;
    peopleAfterCursors.current[peoplePageIndex + 1] = after;
    void loadPeople({
      companyId: company.id,
      category: activeCategory,
      location: activeLocation,
      pageIndex: peoplePageIndex + 1,
      after
    });
  }, [activeCategory, activeLocation, company, loadPeople, peopleEndCursor, peopleHasNext, peoplePageIndex]);

  const handlePeoplePrev = useCallback(() => {
    if (!company || peoplePageIndex === 0) {
      return;
    }
    const after = peopleAfterCursors.current[peoplePageIndex - 1] ?? null;
    void loadPeople({
      companyId: company.id,
      category: activeCategory,
      location: activeLocation,
      pageIndex: peoplePageIndex - 1,
      after
    });
  }, [activeCategory, activeLocation, company, loadPeople, peoplePageIndex]);

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
    void loadDetail({ category: activeCategory, location: activeLocation });
    void loadQuota();
  }, [activeCategory, activeLocation, loadDetail, loadQuota]);

  const handleProcess = useCallback(async () => {
    // Guard against a double-click launching a second processing run — the
    // backend is also idempotent (idempotency key + per-fingerprint lock + quota),
    // but this keeps the UI from firing a second request at all.
    if (!search || processing) {
      return;
    }
    // A fresh key per deliberate click = a new processing attempt; a browser/
    // network replay of this same request reuses the key (same attempt).
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${search.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setProcessing(true);
    setActionError(null);
    setActionNotice(null);
    const result = await prospectGraphql<{ processProspectSearch: { id: string; status: string } }>(
      PROCESS_SEARCH_MUTATION,
      { id: search.id, idempotencyKey }
    );
    setProcessing(false);
    if (result.disabled) {
      setDisabled(true);
      return;
    }
    void loadQuota();
    if (result.error || !result.data) {
      setActionError(result.error ?? "We couldn't start the search. Please try again.");
      await loadDetail({ category: activeCategory });
      return;
    }
    await loadDetail({ category: activeCategory });
  }, [activeCategory, loadDetail, loadQuota, processing, search]);

  const handleCancel = useCallback(async () => {
    if (!search) {
      return;
    }
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
    await loadDetail({ category: activeCategory });
  }, [activeCategory, loadDetail, search]);

  // Opening only requests the in-app confirmation; the mutation runs on confirm.
  const handleDeleteCompany = useCallback((target: CompanyDetail) => {
    setDeleteCompanyError(null);
    setCompanyPendingDeletion(target);
  }, []);

  const confirmDeleteCompany = useCallback(async () => {
    const target = companyPendingDeletion;
    if (!target || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteCompanyError(null);
    const result = await prospectGraphql<{ deleteCompany: boolean }>(DELETE_COMPANY_MUTATION, {
      companyId: target.id
    });
    if (result.disabled) {
      setDeleting(false);
      setCompanyPendingDeletion(null);
      setDisabled(true);
      return;
    }
    if (result.error || !result.data?.deleteCompany) {
      setDeleting(false);
      setDeleteCompanyError(DELETE_COMPANY_ERROR);
      return;
    }
    router.push("/prospects");
  }, [companyPendingDeletion, deleting, router]);

  const reloadCompanyPeople = useCallback(
    async (updatedCompany: CompanyDetail) => {
      setCompany(updatedCompany);
      peopleAfterCursors.current = [null];
      await loadPeople({
        companyId: updatedCompany.id,
        category: activeCategory,
        location: activeLocation,
        pageIndex: 0,
        after: null
      });
    },
    [activeCategory, activeLocation, loadPeople]
  );

  // Extends ONE user-owned child search — the one resolved from the active role
  // tab (or explicitly chosen in the dialog). Never adds a batch to every role
  // search of the grouped company at once.
  const handleAddMore = useCallback(async (targetSearchId: string) => {
    if (!search || search.status !== "READY" || !search.company || expanding || !targetSearchId) {
      return;
    }
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${targetSearchId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setShowAddMoreDialog(false);
    setExpanding(true);
    setActionError(null);
    setActionNotice(null);

    const result = await prospectGraphql<{ addMoreDiscoverPeople: DiscoverSearchExpansion }>(
      ADD_MORE_DISCOVER_PEOPLE_MUTATION,
      { searchId: targetSearchId, idempotencyKey }
    );
    setExpanding(false);
    void loadQuota();

    if (result.disabled) {
      setDisabled(true);
      return;
    }
    if (result.error || !result.data) {
      setActionError(result.error ?? "Could not add more people. Please try again.");
      return;
    }

    const expansion = result.data.addMoreDiscoverPeople;
    // Exhaustion is per child search — only mirror it locally when it applies
    // to the search this page is routed on.
    if (expansion.exhausted && expansion.searchId === search.id) {
      setSessionExhausted(true);
    }
    setActionNotice({ message: expansion.message ?? `${expansion.addedCount} new people were added.` });

    // Refresh counts + people in place (new people land on later pages).
    if (search.company) {
      peopleAfterCursors.current = [null];
      await loadCompany(search.company.id);
      await loadPeople({
        companyId: search.company.id,
        category: activeCategory,
        location: activeLocation,
        pageIndex: 0,
        after: null
      });
    }
    await loadDetail({ category: activeCategory, location: activeLocation });
  }, [activeCategory, activeLocation, expanding, loadCompany, loadDetail, loadPeople, loadQuota, search]);

  // Disclosure for the "Search this company" panel. Opening is a plain toggle;
  // closing hands focus back to the header trigger so keyboard users are never
  // dropped when the panel unmounts.
  const handleToggleCompanySearch = useCallback(() => {
    setCompanySearchOpen((open) => !open);
  }, []);

  const handleCloseCompanySearch = useCallback(() => {
    setCompanySearchOpen(false);
    companySearchTriggerRef.current?.focus();
  }, []);

  // "Search this company": run the SAME company again with a new role/location.
  // A duplicate role+location never reaches the backend — the client pre-check
  // answers instantly with the same copy the server would return — and the
  // server re-checks authoritatively (no quota charge, no provider call).
  const handleSearchCompany = useCallback(async () => {
    if (!company || companySearching) {
      return;
    }
    const validated = validateCompanyRoleSearchInput({ jobTitle: companyRoleTitle, location: companyRoleLocation });
    if (!validated.ok) {
      setCompanySearchNotice({ tone: "error", message: validated.message });
      return;
    }
    const precheck = resolveCompanyRoleSearchAction({
      jobTitle: validated.jobTitle,
      location: validated.location,
      existingSearches: company.searches ?? []
    });
    if (precheck.kind === "duplicate") {
      setCompanySearchNotice({ tone: "info", message: precheck.message });
      return;
    }

    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${company.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCompanySearching(true);
    setCompanySearchNotice(null);
    const result = await prospectGraphql<{ searchCompanyRole: Pick<ProspectSearchNode, "id" | "status" | "errorCode" | "errorTitle" | "errorMessage" | "retryable"> }>(
      SEARCH_COMPANY_ROLE_MUTATION,
      {
        companyId: company.id,
        jobTitle: validated.jobTitle,
        location: validated.location,
        idempotencyKey
      }
    );
    setCompanySearching(false);
    void loadQuota();

    if (result.disabled) {
      setDisabled(true);
      return;
    }
    if (result.error || !result.data) {
      setCompanySearchNotice({
        tone: result.errorCode === "DUPLICATE_ROLE_LOCATION" ? "info" : "error",
        message: result.error ?? "We couldn't start the search. Please try again."
      });
      return;
    }
    const created = result.data.searchCompanyRole;
    if (created.status === "FAILED") {
      setCompanySearchNotice({ tone: "error", message: formatSearchError(created).message });
      await loadDetail({ category: activeCategory, location: activeLocation });
      return;
    }
    // Success: the new role/location group now belongs to this company page.
    // The panel collapses again (space is reclaimed) and the page-level notice
    // confirms the new group.
    setCompanySearchOpen(false);
    setCompanyRoleTitle("");
    setCompanyRoleLocation("");
    setActionNotice({ message: companySearchSuccessMessage(validated.jobTitle, validated.location) });
    await loadDetail({ category: activeCategory, location: activeLocation });
  }, [
    activeCategory,
    activeLocation,
    company,
    companyRoleLocation,
    companyRoleTitle,
    companySearching,
    loadDetail,
    loadQuota
  ]);

  // Opens/closes the source-url or manual-fix editor. Pressing the active
  // mode's button closes it; pressing the other swaps the single editor.
  const handleToggleFormatMode = useCallback(
    (requested: "source-url" | "manual-fix") => {
      if (refreshingFormat) {
        return;
      }
      setFormatActionMode((current) => resolveNextEmailFormatMode(current, requested));
    },
    [refreshingFormat]
  );

  const handleRefreshEmailFormat = useCallback(
    async (target: CompanyDetail, sourceUrl?: string | null) => {
      // Re-entry guard: one correction request at a time, never duplicated.
      if (refreshingFormat) {
        return;
      }
      setRefreshingFormat(true);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ refreshCompanyEmailFormat: CompanyDetail }>(
        REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
        { companyId: target.id, sourceUrl: sourceUrl?.trim() || null }
      );
      setRefreshingFormat(false);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        // Failure keeps the source editor open for a retry — nothing is appended.
        setActionError(result.error ?? "Could not refresh the email format.");
        return;
      }
      // Success closes the editor and refreshes the displayed evidence.
      setFormatActionMode("none");
      setFormatSourceUrl("");
      const refreshedCompany = result.data.refreshCompanyEmailFormat;
      await reloadCompanyPeople(refreshedCompany);
      const message = emailFormatDiscoveryMessage(
        refreshedCompany,
        Boolean(refreshedCompany.emailDomain && refreshedCompany.emailPattern)
      );
      if (isEmailFormatProviderFailure(refreshedCompany)) {
        setActionError(message);
      } else {
        setActionNotice({ message });
      }
    },
    [refreshingFormat, reloadCompanyPeople]
  );

  const handleDiscoverEmailFormat = useCallback(
    async (target: CompanyDetail, force = false) => {
      if (refreshingFormat) {
        return;
      }
      setRefreshingFormat(true);
      // AI refresh has no form: it closes any open editor and shows its
      // progress state in the same single editor container.
      setFormatActionMode("ai-refresh");
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ discoverCompanyEmailFormat: CompanyDetail }>(
        DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
        { companyId: target.id, force }
      );
      setRefreshingFormat(false);
      setFormatActionMode("none");
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        setActionError(result.error ?? "Could not find the email format with AI.");
        return;
      }
      const discoveredCompany = result.data.discoverCompanyEmailFormat;
      await reloadCompanyPeople(discoveredCompany);
      const message = emailFormatDiscoveryMessage(
        discoveredCompany,
        Boolean(discoveredCompany.emailDomain && discoveredCompany.emailPattern)
      );
      if (isEmailFormatProviderFailure(discoveredCompany)) {
        setActionError(message);
      } else {
        setActionNotice({ message });
      }
    },
    [refreshingFormat, reloadCompanyPeople]
  );

  const handleManualEmailFormat = useCallback(
    async (target: CompanyDetail) => {
      if (refreshingFormat) {
        return;
      }
      setRefreshingFormat(true);
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
      setRefreshingFormat(false);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
        // Failure keeps the manual editor open for a retry — nothing is appended.
        setActionError(result.error ?? "Could not apply the manual email format.");
        return;
      }
      setFormatActionMode("none");
      await reloadCompanyPeople(result.data.setCompanyEmailInferenceOverride);
      setActionNotice({ message: "Manual email format applied." });
    },
    [manualConfidence, manualEmailDomain, manualEmailPattern, refreshingFormat, reloadCompanyPeople]
  );

  const visiblePeople = useMemo(() => filterPeopleByText(people, peopleFilter), [people, peopleFilter]);
  const visibleCategories = useMemo(
    () => (company ? company.positions.filter((position) => position.peopleCount > 0) : []),
    [company]
  );
  const peopleOffset = peoplePageIndex * PEOPLE_PAGE_SIZE;
  const peoplePageCount = resolvePageCount(peopleTotal, PEOPLE_PAGE_SIZE);

  const searchExhausted = Boolean(search && (search.exhausted || sessionExhausted));
  const showAddMore =
    search !== null &&
    shouldShowAddMore({
      view: selectedView,
      status: search.status,
      hasResults: (company?.peopleCount ?? search.peopleCount) > 0,
      exhausted: searchExhausted
    });
  const addMoreDisabled = addMoreDisabledReason(quota, expanding);

  // The grouped company's child searches (this user's only). Falls back to the
  // routed search so a company payload without siblings still targets itself.
  const companySearches = useMemo<AddMoreCandidateSearch[]>(() => {
    if (company?.searches && company.searches.length > 0) {
      return company.searches.map((child) => ({
        id: child.id,
        status: child.status,
        requestedTitles: child.requestedTitles,
        requestedLocations: child.requestedLocations,
        positionCategories: child.positionCategories,
        createdAt: child.createdAt
      }));
    }
    if (!search) {
      return [];
    }
    return [
      {
        id: search.id,
        status: search.status,
        requestedTitles: search.requestedTitles,
        requestedLocations: search.requestedLocations,
        positionCategories: [],
        createdAt: search.createdAt
      }
    ];
  }, [company, search]);

  // Which child search "Add 10 more" extends (or whether the user must choose).
  // An active location chip narrows the target to that location's group, so
  // viewing "Software Engineer · Canada" never extends the United States group.
  const addMoreTarget = useMemo<AddMoreTarget>(
    () =>
      resolveAddMoreTarget({
        activeCategory,
        activeLocationKey: activeLocation,
        searches: companySearches,
        currentSearchId: search?.id ?? ""
      }),
    [activeCategory, activeLocation, companySearches, search?.id]
  );

  // Location chips: distinct requested locations across this company's READY
  // searches (canonically deduped — never two chips for one location).
  const locationOptions = useMemo<LocationFilterOption[]>(
    () => buildLocationFilterOptions(companySearches),
    [companySearches]
  );
  const filtersActive = activeCategory !== null || activeLocation !== null;

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
  // "Select all matching" scopes by company + role category only — the server
  // selection input has no location dimension — so it is hidden while a
  // location chip is active to keep bulk actions exact.
  const canSelectAllMatching = Boolean(
    company &&
      selection.mode !== "allMatching" &&
      activeLocation === null &&
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
      setReviewError(result.error ?? "The selected contacts could not be prepared for import. Please try again.");
      return;
    }
    const importResult = result.data.createProspectImport;
    setReview(importResult.review);
    setReviewOpen(false);
    clearSelection();
    const readyCount = importResult.review.exportableCount;
    setActionNotice({
      message: `${readyCount} ${readyCount === 1 ? "contact is" : "contacts are"} ready for field selection.`,
      href: `/imports?pendingImportId=${encodeURIComponent(importResult.importId)}`,
      label: "Review fields"
    });
  }, [buildCurrentSelectionInput, clearSelection, creatingImport, preparingExport]);

  // ---- Render -------------------------------------------------------------

  if (disabled) {
    return (
      <div className={styles.page}>
        <DisabledState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<Building2 aria-hidden="true" />}
          title="This Discover search is no longer available."
          body="It may have been deleted, or the link is no longer valid."
          action={
            <Link href="/prospects" className={styles.primaryButton}>
              <ArrowLeft aria-hidden="true" />
              <span>Back to Discover</span>
            </Link>
          }
        />
      </div>
    );
  }

  if (searchLoading && !search) {
    return (
      <div className={styles.page}>
        <DetailSkeleton />
      </div>
    );
  }

  if (!search) {
    return <div className={styles.page} />;
  }

  // Grouped header: distinct requested roles across ALL of this user's searches
  // for the company (one Walmart page covers Software Engineer + Recruiter).
  // The people count is the company query's unique union of allocated people.
  const groupedRoles = company ? groupedRoleLabels(company.searches ?? []) : [];
  const roleLabel =
    groupedRoles.length > 0
      ? groupedRoles.join(", ")
      : search.requestedTitles.length > 0
        ? search.requestedTitles.join(", ")
        : "Any role";
  const locationLabel = search.requestedLocations[0] ?? "Any location";
  const headerPeopleCount = company?.peopleCount ?? search.peopleCount;
  const detailStage = resolveDetailStage(search);

  return (
    <div className={styles.page}>
      <header
        className={styles.detailHeader}
        data-discover-tour="detail-header"
        data-discover-detail-stage={detailStage ?? "none"}
      >
        <div className={styles.detailHeaderIdentity}>
          <div className={styles.headerCompanyIcon} aria-hidden="true">
            <Building2 />
          </div>
          <div className={styles.detailHeaderCopy}>
            <p className={styles.eyebrow}>
              <Users aria-hidden="true" /> Search
            </p>
            <h1 className={styles.detailHeaderTitle}>{search.company?.name ?? search.requestedCompany}</h1>
            <p className={styles.subtitle}>
              {roleLabel} · {locationLabel}
            </p>
            <div className={styles.detailHeaderMeta}>
              <BadgePill badge={statusBadge(search.status)} />
              <span className={styles.detailHeaderMetaItem}>
                <Users aria-hidden="true" /> {headerPeopleCount} {headerPeopleCount === 1 ? "person" : "people"}
              </span>
              <span className={styles.detailHeaderMetaItem}>
                {selectedView === "ready" && search.completedAt
                  ? `Completed ${formatDateTime(search.completedAt)}`
                  : `Created ${formatDateTime(search.createdAt)}`}
              </span>
              {company?.officialWebsite && (
                <a
                  className={styles.detailHeaderLink}
                  href={company.officialWebsite}
                  target={EXTERNAL_LINK_TARGET}
                  rel={EXTERNAL_LINK_REL}
                >
                  {company.officialWebsiteDomain ?? company.officialDomain ?? "Website"}{" "}
                  <ExternalLink aria-hidden="true" />
                </a>
              )}
              {company?.linkedinUrl && (
                <a
                  className={styles.detailHeaderLink}
                  href={company.linkedinUrl}
                  target={EXTERNAL_LINK_TARGET}
                  rel={EXTERNAL_LINK_REL}
                >
                  LinkedIn <ExternalLink aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <QuotaIndicator quota={quota} />
          {selectedView === "ready" && company && (
            <button
              type="button"
              ref={companySearchTriggerRef}
              className={`${styles.companySearchTrigger} ${companySearchOpen ? styles.companySearchTriggerOpen : ""}`}
              onClick={handleToggleCompanySearch}
              aria-expanded={companySearchOpen}
              aria-controls={COMPANY_SEARCH_PANEL_ID}
              aria-label={COMPANY_SEARCH_TITLE}
              title={COMPANY_SEARCH_TITLE}
              data-discover-tour="company-search"
            >
              <Search className={styles.companySearchTriggerIcon} aria-hidden="true" />
              <span>{COMPANY_SEARCH_TRIGGER_LABEL}</span>
              <ChevronDown className={styles.companySearchTriggerChevron} aria-hidden="true" />
            </button>
          )}
          {selectedView === "ready" && company && (
            <button
              type="button"
              className={styles.dangerGhostButton}
              onClick={() => handleDeleteCompany(company)}
              disabled={deleting}
              title="Delete this company and its saved results"
              data-discover-tour="delete-search"
            >
              {deleting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Trash2 aria-hidden="true" />}
              <span>Delete</span>
            </button>
          )}
        </div>
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
          <CircularCloseButton compact label="Dismiss" onClick={() => setActionNotice(null)} />
        </div>
      )}

      {(selectedView === "processing" || selectedView === "canceled" || selectedView === "failed") && (
        <StatusCard
          search={search}
          quota={quota}
          processing={processing}
          onProcess={handleProcess}
          onCancel={handleCancel}
        />
      )}

      {selectedView === "ready" && (
        <>
          {/* "Search this company" modal — mounted only while open, so the
              closed page never spends space on the form. It renders as a
              compact centered dialog over the page, opened from the header
              trigger. */}
          {company && companySearchOpen && (
            <SearchCompanyCard
              panelId={COMPANY_SEARCH_PANEL_ID}
              quota={quota}
              jobTitle={companyRoleTitle}
              location={companyRoleLocation}
              searching={companySearching}
              notice={companySearchNotice}
              onJobTitleChange={setCompanyRoleTitle}
              onLocationChange={setCompanyRoleLocation}
              onDismissNotice={() => setCompanySearchNotice(null)}
              onSubmit={handleSearchCompany}
              onClose={handleCloseCompanySearch}
            />
          )}

          <ResultsQualityCard company={company} loading={companyLoading} />

          <EmailFormatPanel
            company={company}
            loading={companyLoading}
            refreshingFormat={Boolean(company && refreshingFormat)}
            actionMode={formatActionMode}
            formatSourceUrl={formatSourceUrl}
            manualEmailDomain={manualEmailDomain}
            manualEmailPattern={manualEmailPattern}
            manualConfidence={manualConfidence}
            onFormatSourceUrlChange={setFormatSourceUrl}
            onSelectMode={handleToggleFormatMode}
            onCloseEditor={() => setFormatActionMode("none")}
            onManualEmailDomainChange={setManualEmailDomain}
            onManualEmailPatternChange={setManualEmailPattern}
            onManualConfidenceChange={setManualConfidence}
            onRefreshEmailFormat={handleRefreshEmailFormat}
            onDiscoverEmailFormat={handleDiscoverEmailFormat}
            onManualEmailFormat={handleManualEmailFormat}
          />

          {company && (
            <div className={`card ${styles.peopleSection}`}>
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>People</h2>
                  <p className={styles.panelSubtitle}>
                    {visibleCategories.length > 0
                      ? `${visibleCategories.length} role ${visibleCategories.length === 1 ? "group" : "groups"} · ${PEOPLE_PAGE_SIZE} per page`
                      : `${PEOPLE_PAGE_SIZE} per page`}
                  </p>
                </div>
                {showAddMore && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    data-discover-tour="add-more-people"
                    onClick={() => setShowAddMoreDialog(true)}
                    disabled={addMoreDisabled !== null}
                    title={addMoreDisabled ?? undefined}
                    aria-label={ADD_MORE_PEOPLE_LABEL}
                  >
                    {expanding ? (
                      <LoaderCircle className={styles.spin} aria-hidden="true" />
                    ) : (
                      <UserPlus aria-hidden="true" />
                    )}
                    <span>{expanding ? ADD_MORE_LOADING_LABEL : ADD_MORE_PEOPLE_LABEL}</span>
                  </button>
                )}
              </div>

              {/* Quiet, compact filter bar. Each control is ONE pill — a muted
                  inline label plus a native <select> with the browser chrome
                  stripped — so any number of role groups or locations stays
                  scannable without a chip wall or a shouty toolbar heading. */}
              <div className={styles.peopleFilterBar} data-discover-tour="role-filters">
                <label
                  className={`${styles.peopleFilterControl} ${
                    activeCategory !== null ? styles.peopleFilterControlActive : ""
                  }`}
                >
                  <span className={styles.peopleFilterPrefix}>Role</span>
                  <select
                    className={styles.peopleFilterSelect}
                    aria-label="Filter by role"
                    value={activeCategory ?? ALL_ROLES_VALUE}
                    onChange={(event) => {
                      const value = event.target.value;
                      handleSelectCategory(value === ALL_ROLES_VALUE ? null : (value as PositionCategory));
                    }}
                  >
                    <option value={ALL_ROLES_VALUE}>{ALL_ROLES_LABEL}</option>
                    {visibleCategories.map((position) => (
                      <option key={position.id} value={position.category}>
                        {position.displayName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={styles.peopleFilterChevron} aria-hidden="true" />
                </label>

                {locationOptions.length > 0 && (
                  <label
                    className={`${styles.peopleFilterControl} ${
                      activeLocation !== null ? styles.peopleFilterControlActive : ""
                    }`}
                    data-discover-tour="location-filters"
                  >
                    <span className={styles.peopleFilterPrefix}>Location</span>
                    <select
                      className={styles.peopleFilterSelect}
                      aria-label="Filter by location"
                      value={activeLocation ?? ALL_LOCATIONS_VALUE}
                      onChange={(event) => {
                        const value = event.target.value;
                        handleSelectLocation(value === ALL_LOCATIONS_VALUE ? null : value);
                      }}
                    >
                      <option value={ALL_LOCATIONS_VALUE}>{ALL_LOCATIONS_LABEL}</option>
                      {locationOptions.map((option) => (
                        <option key={option.key || "__any_location"} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={styles.peopleFilterChevron} aria-hidden="true" />
                  </label>
                )}

                {filtersActive && (
                  <button
                    type="button"
                    className={styles.peopleFilterClear}
                    onClick={handleClearFilters}
                    aria-label={CLEAR_FILTERS_LABEL}
                  >
                    <X aria-hidden="true" />
                    <span>{CLEAR_FILTERS_LABEL}</span>
                  </button>
                )}
              </div>

              <div className={styles.noticeBanner} role="note" data-discover-tour="inferred-warning">
                <AlertCircle aria-hidden="true" />
                <span>{INFERRED_EMAIL_NOTICE}</span>
              </div>

              <div className={styles.peopleToolbar}>
                <div className={styles.filterField} data-discover-tour="people-filter">
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
                      ? company.positions.find((position) => position.category === activeCategory)?.displayName ??
                        "this role group"
                      : null
                  }
                  onSelectAll={handleSelectAllMatching}
                />
              )}

              <div className={styles.peopleTableShell} data-discover-tour="people-table">
                <PeopleTable
                  people={visiblePeople}
                  loading={peopleLoading}
                  error={peopleError}
                  copiedId={copiedId}
                  pageSelectionState={pageSelectionState}
                  selectionScope={selectionScope}
                  selection={selection}
                  filtersActive={filtersActive}
                  onClearFilters={handleClearFilters}
                  onTogglePage={handleTogglePageSelection}
                  onTogglePerson={handleTogglePersonSelection}
                  onCopy={handleCopyEmail}
                />
              </div>

              <div className={styles.paginationRow} data-discover-tour="people-pagination">
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
      <AddMorePeopleDialog
        open={showAddMoreDialog}
        peopleCount={company?.peopleCount ?? search.peopleCount ?? 0}
        quota={quota}
        expanding={expanding}
        target={addMoreTarget}
        onConfirm={handleAddMore}
        onClose={() => setShowAddMoreDialog(false)}
      />
      <AppConfirmDialog
        open={companyPendingDeletion !== null}
        title="Delete this company?"
        description={
          companyPendingDeletion
            ? `Deleting “${companyPendingDeletion.name}” will remove the company, its inferred people, and related searches. This action cannot be undone.`
            : null
        }
        confirmLabel="Delete company"
        loadingLabel="Deleting…"
        destructive
        loading={deleting}
        error={deleteCompanyError}
        onConfirm={() => void confirmDeleteCompany()}
        onCancel={() => {
          if (!deleting) {
            setCompanyPendingDeletion(null);
            setDeleteCompanyError(null);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail sub-components
// ---------------------------------------------------------------------------

// Tone → CSS class for the quality stats, bar segments, and legend swatches.
const QUALITY_TONE_CLASS: Record<QualitySegmentTone, string> = {
  verified: styles.qualityToneVerified,
  high: styles.qualityToneHigh,
  medium: styles.qualityToneMedium,
  review: styles.qualityToneReview,
  unavailable: styles.qualityToneUnavailable,
  invalid: styles.qualityToneInvalid,
  suppressed: styles.qualityToneSuppressed,
  unsubscribed: styles.qualityToneUnsubscribed
};

function ResultsQualityCard({ company, loading }: { company: CompanyDetail | null; loading: boolean }) {
  if (loading && !company) {
    return (
      <div className={`card ${styles.qualityCard}`} data-discover-tour="quality-summary">
        <div className={styles.skeletonLine} style={{ width: "30%" }} />
        <div className={styles.skeletonLine} style={{ width: "100%" }} />
        <div className={styles.skeletonLine} style={{ width: "55%" }} />
      </div>
    );
  }
  if (!company) {
    return null;
  }
  const summary = deriveDiscoverQualitySummary(company.emailStatusCounts);
  const segments = buildQualitySegments(company.emailStatusCounts);
  const description = describeQualitySummary(summary);
  const usablePercent = qualityPercent(summary.usable, summary.total);

  const stats: Array<{ key: string; label: string; value: number; hint: string; tone?: QualitySegmentTone }> = [
    { key: "total", label: "People found", value: summary.total, hint: "Everyone attached to this search." },
    {
      key: "usable",
      label: "Usable",
      value: summary.usable,
      hint: "Have an inferred or verified address and are eligible for export and Imports.",
      tone: "high"
    },
    {
      key: "review",
      label: "Needs review",
      value: summary.needsReview,
      hint: "Low-confidence addresses — counted in usable, review them before outreach.",
      tone: "review"
    },
    {
      key: "unavailable",
      label: "Unavailable",
      value: summary.unavailable,
      hint: "No address could be inferred. These are skipped during export and Imports.",
      tone: "unavailable"
    },
    {
      key: "invalid",
      label: "Invalid",
      value: summary.invalid,
      hint: "Address not found or failed validation. These contacts are skipped during sending, export, and Imports.",
      tone: "invalid"
    },
    // Excluded-by-choice categories appear only when present, so the strip
    // stays compact in the common case. Unsubscribed is never labelled Failed.
    ...(summary.suppressed > 0
      ? [
          {
            key: "suppressed",
            label: "Suppressed",
            value: summary.suppressed,
            hint: "Explicitly excluded from outreach.",
            tone: "suppressed" as QualitySegmentTone
          }
        ]
      : []),
    ...(summary.unsubscribed > 0
      ? [
          {
            key: "unsubscribed",
            label: "Unsubscribed",
            value: summary.unsubscribed,
            hint: "Opted out of outreach — excluded, but not a delivery failure.",
            tone: "unsubscribed" as QualitySegmentTone
          }
        ]
      : [])
  ];

  return (
    <section className={`card ${styles.qualityCard}`} data-discover-tour="quality-summary" aria-label="Results quality">
      <div className={styles.qualityHead}>
        <div>
          <h2 className={styles.panelTitle}>Results quality</h2>
          <p className={styles.panelSubtitle}>How much of this search is ready for outreach.</p>
        </div>
        {summary.total > 0 && (
          <span className={styles.qualityHeadline} title={description}>
            <strong className={styles.qualityHeadlineValue}>{usablePercent}%</strong> usable
          </span>
        )}
      </div>

      <dl className={styles.qualityStats}>
        {stats.map((stat) => (
          <div key={stat.key} className={styles.qualityStat} title={stat.hint}>
            <dt className={styles.qualityStatLabel}>
              {stat.tone && (
                <span className={`${styles.qualityDot} ${QUALITY_TONE_CLASS[stat.tone]}`} aria-hidden="true" />
              )}
              {stat.label}
            </dt>
            <dd className={styles.qualityStatValue}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {segments.length > 0 ? (
        <div className={styles.qualityBreakdown} data-discover-tour="quality-breakdown">
          <div className={styles.qualityBarTrack} role="img" aria-label={`Email quality distribution: ${description}`}>
            {segments.map((segment) => (
              <span
                key={segment.status}
                className={`${styles.qualitySegment} ${QUALITY_TONE_CLASS[segment.tone]}`}
                style={{ width: `${segment.share}%` }}
                title={`${segment.label}: ${segment.count} (${segment.percent}%)`}
              />
            ))}
          </div>
          <ul className={styles.qualityLegend}>
            {segments.map((segment) => (
              <li key={segment.status} className={styles.qualityLegendItem}>
                <span className={`${styles.qualityDot} ${QUALITY_TONE_CLASS[segment.tone]}`} aria-hidden="true" />
                <span>{segment.label}</span>
                <span className={styles.qualityLegendCount}>
                  {segment.count} · {segment.percent}%
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.qualityCaption}>
            {summary.usable === 0 ? `No usable emails were generated for this result. ${description}` : description}
          </p>
        </div>
      ) : (
        <p className={styles.qualityEmpty} data-discover-tour="quality-breakdown">
          Email-quality information will appear when people are added to this search.
        </p>
      )}
    </section>
  );
}

const CONFIDENCE_TICKS: Record<ConfidenceLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNAVAILABLE: 0 };

function ConfidenceIndicator({ level }: { level: ConfidenceLevel }) {
  const badge = confidenceBadge(level);
  const ticks = CONFIDENCE_TICKS[level] ?? 0;
  return (
    <span className={styles.confidenceIndicator}>
      <BadgePill badge={badge} />
      <span className={styles.confidenceTicks} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} className={`${styles.confidenceTick} ${index < ticks ? styles.confidenceTickOn : ""}`} />
        ))}
      </span>
    </span>
  );
}

function emailFormatDiscoveryMessage(company: CompanyDetail, hasEmailFormat: boolean): string {
  if (hasEmailFormat || company.emailFormatDiscoveryStatus === "FOUND") {
    return "Email format discovered successfully from public evidence. Generated addresses remain inferred.";
  }
  switch (company.emailFormatDiscoveryStatus) {
    case "NO_EVIDENCE":
      return "No public email-format evidence was found.";
    case "NOT_CONFIGURED":
      return "AI email-format discovery is not configured.";
    case "AUTH_ERROR":
      return "The AI provider rejected the email-format request.";
    case "RATE_LIMITED":
      return "The AI provider is temporarily rate-limited. Email-format discovery will be retried.";
    case "NETWORK_ERROR":
      return "The AI provider could not be reached. Email-format discovery will be retried.";
    case "BAD_PROVIDER_RESPONSE":
      return "The AI provider returned an unusable response. Email-format discovery will be retried.";
    case "PARSER_REJECTED_RESPONSE":
      return "The provider response could not be parsed safely. Email-format discovery will be retried.";
    default:
      return "Email-format discovery has not completed yet.";
  }
}

function isEmailFormatProviderFailure(company: CompanyDetail): boolean {
  return !["NOT_ATTEMPTED", "FOUND", "NO_EVIDENCE"].includes(company.emailFormatDiscoveryStatus);
}

function EmailFormatPanel({
  company,
  loading,
  refreshingFormat,
  actionMode,
  formatSourceUrl,
  manualEmailDomain,
  manualEmailPattern,
  manualConfidence,
  onFormatSourceUrlChange,
  onSelectMode,
  onCloseEditor,
  onManualEmailDomainChange,
  onManualEmailPatternChange,
  onManualConfidenceChange,
  onRefreshEmailFormat,
  onDiscoverEmailFormat,
  onManualEmailFormat
}: {
  company: CompanyDetail | null;
  loading: boolean;
  refreshingFormat: boolean;
  actionMode: EmailFormatActionMode;
  formatSourceUrl: string;
  manualEmailDomain: string;
  manualEmailPattern: string;
  manualConfidence: ConfidenceLevel;
  onFormatSourceUrlChange: (value: string) => void;
  onSelectMode: (mode: "source-url" | "manual-fix") => void;
  onCloseEditor: () => void;
  onManualEmailDomainChange: (value: string) => void;
  onManualEmailPatternChange: (value: string) => void;
  onManualConfidenceChange: (value: ConfidenceLevel) => void;
  onRefreshEmailFormat: (company: CompanyDetail, sourceUrl?: string | null) => void;
  onDiscoverEmailFormat: (company: CompanyDetail, force?: boolean) => void;
  onManualEmailFormat: (company: CompanyDetail) => void;
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
  const domainDiffers = Boolean(websiteDomain && company.emailDomain && websiteDomain !== company.emailDomain);
  const firstDomainEvidence =
    company.emailDomainEvidence.find((row) => row.emailDomain === company.emailDomain) ??
    company.emailDomainEvidence[0] ??
    null;
  const firstPatternEvidence =
    company.patternEvidence.find(
      (row) =>
        row.pattern === company.emailPattern &&
        (!company.emailDomain || !row.emailDomain || row.emailDomain === company.emailDomain)
    ) ??
    company.patternEvidence[0] ??
    null;
  const hasEmailFormat = Boolean(company.emailDomain && company.emailPattern);
  // Email confidence tracks the Results quality card: it is derived from the
  // usable share of the SAME per-status counts (80%+ High, 50–79% Medium,
  // below Low), so a format whose generated addresses mostly failed can never
  // keep advertising High. Pattern confidence stays the discovery-evidence
  // level on purpose.
  const emailConfidence = emailConfidenceFromUsableRate(deriveDiscoverQualitySummary(company.emailStatusCounts));
  const discoveryMessage = emailFormatDiscoveryMessage(company, hasEmailFormat);
  const evidenceSummary = emailFormatEvidenceSummary({
    emailFormatReason: company.emailFormatReason,
    emailDomainConfidence: company.emailDomainConfidence,
    patternConfidence: company.patternConfidence,
    selectedEmailDomain: company.emailDomain,
    selectedPattern: company.emailPattern,
    domainEvidence: company.emailDomainEvidence,
    patternEvidence: company.patternEvidence
  });
  const aiRunning = refreshingFormat && actionMode === "ai-refresh";
  return (
    <section
      className={`card ${styles.companyCard}`}
      data-discover-tour="company-details"
      aria-label="Email format intelligence"
    >
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>
            <AtSign aria-hidden="true" className={styles.panelTitleIcon} /> Email format
          </h2>
          <p className={styles.panelSubtitle}>
            {discoveryMessage}
          </p>
        </div>
        {hasEmailFormat && (
          <span className={styles.inferredTag} title="Generated addresses are inferred until verified.">
            <AlertCircle aria-hidden="true" /> Inferred · not verified
          </span>
        )}
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
          <ConfidenceIndicator level={emailConfidence} />
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Pattern confidence</span>
          <ConfidenceIndicator level={company.patternConfidence} />
        </div>
        {company.emailFormatDiscoveredAt && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Last checked</span>
            <span className={styles.metaValue}>{formatDateTime(company.emailFormatDiscoveredAt)}</span>
          </div>
        )}
      </div>
      <div className={styles.evidencePanel} data-discover-tour="email-evidence">
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
          <span className={styles.metaHint}>{discoveryMessage}</span>
        )}
        <span className={styles.evidenceAgreement}>{evidenceSummary}</span>
      </div>
      <div className={styles.formatActions}>
        <div className={styles.formatActionText}>
          <span className={styles.metaLabel}>Email format controls</span>
          <span className={styles.metaHint}>
            One correction at a time — search public evidence with AI, parse a trusted source URL, or set the format
            manually.
          </span>
        </div>
        <div className={styles.formatButtonRow} role="group" aria-label="Email format corrections">
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onDiscoverEmailFormat(company, hasEmailFormat)}
            disabled={refreshingFormat}
            data-discover-tour="refresh-ai"
          >
            {aiRunning ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Sparkles aria-hidden="true" />}
            <span>{aiRunning ? "Refreshing…" : hasEmailFormat ? "Refresh with AI" : "Find with AI"}</span>
          </button>
          <button
            type="button"
            className={`${styles.ghostButton} ${actionMode === "source-url" ? styles.modeButtonActive : ""}`}
            onClick={() => onSelectMode("source-url")}
            disabled={refreshingFormat}
            aria-pressed={actionMode === "source-url"}
            aria-expanded={actionMode === "source-url"}
            data-discover-tour="source-url"
          >
            Use source URL
          </button>
          <button
            type="button"
            className={`${styles.ghostButton} ${actionMode === "manual-fix" ? styles.modeButtonActive : ""}`}
            onClick={() => onSelectMode("manual-fix")}
            disabled={refreshingFormat}
            aria-pressed={actionMode === "manual-fix"}
            aria-expanded={actionMode === "manual-fix"}
            data-discover-tour="manual-format"
          >
            Fix manually
          </button>
        </div>
        {/* ONE stable editor container — it swaps its contents by mode, so the
            card can never accumulate a second form no matter how buttons are
            clicked. */}
        <div className={styles.editorShell} data-discover-action-mode={actionMode}>
          {actionMode === "ai-refresh" && (
            <div className={`${styles.editorPanel} ${styles.editorProgress}`} role="status">
              <LoaderCircle aria-hidden="true" className={styles.spin} />
              <span>Refreshing… checking public email-format sources.</span>
            </div>
          )}
          {actionMode === "source-url" && (
            <div className={styles.editorPanel}>
              <div className={styles.editorHead}>
                <span className={styles.metaLabel}>Parse a public source</span>
                <CircularCloseButton compact label="Close source editor" onClick={onCloseEditor} disabled={refreshingFormat} />
              </div>
              <div className={styles.sourceRefreshRow}>
                <input
                  className={styles.input}
                  value={formatSourceUrl}
                  onChange={(event) => onFormatSourceUrlChange(event.target.value)}
                  placeholder="https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
                  aria-label="Specific public email-format source URL"
                  disabled={refreshingFormat}
                />
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => onRefreshEmailFormat(company, formatSourceUrl)}
                  disabled={refreshingFormat || !formatSourceUrl.trim()}
                >
                  {refreshingFormat ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
                  <span>{refreshingFormat ? "Parsing…" : "Parse source"}</span>
                </button>
              </div>
            </div>
          )}
          {actionMode === "manual-fix" && (
            <div className={styles.editorPanel}>
              <div className={styles.editorHead}>
                <span className={styles.metaLabel}>Set the format manually</span>
                <CircularCloseButton compact label="Close manual editor" onClick={onCloseEditor} disabled={refreshingFormat} />
              </div>
              <div className={styles.manualFormatGrid}>
                <input
                  className={styles.input}
                  value={manualEmailDomain}
                  onChange={(event) => onManualEmailDomainChange(event.target.value)}
                  placeholder="amat.com"
                  aria-label="Manual email domain"
                  disabled={refreshingFormat}
                />
                <select
                  className={`${styles.input} ${styles.selectField}`}
                  value={manualEmailPattern}
                  onChange={(event) => onManualEmailPatternChange(event.target.value)}
                  aria-label="Manual email pattern"
                  disabled={refreshingFormat}
                >
                  {EMAIL_PATTERN_OPTIONS.map((pattern) => (
                    <option key={pattern} value={pattern}>
                      {pattern}
                    </option>
                  ))}
                </select>
                <select
                  className={`${styles.input} ${styles.selectField}`}
                  value={manualConfidence}
                  onChange={(event) => onManualConfidenceChange(event.target.value as ConfidenceLevel)}
                  aria-label="Manual confidence"
                  disabled={refreshingFormat}
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
                  {refreshingFormat ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
                  <span>{refreshingFormat ? "Applying…" : "Apply manual fix"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
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

/**
 * "Search this company" dialog: compact same-company search — a new role
 * and/or location for the company already on this page, without going back to
 * the main Discover page. Opens from the premium header trigger as a CENTERED
 * MODAL CARD (the page's shared modalOverlay pattern, styled after the
 * confirm-dialog card) — never an always-visible full-width section. Escape,
 * the close X, and Cancel all collapse it. Duplicate role+location submits are
 * answered inline (pre-check + server 409) and pointed at "Add 10 more".
 */
function SearchCompanyCard({
  panelId,
  quota,
  jobTitle,
  location,
  searching,
  notice,
  onJobTitleChange,
  onLocationChange,
  onDismissNotice,
  onSubmit,
  onClose
}: {
  panelId: string;
  quota: DiscoverQuota | null;
  jobTitle: string;
  location: string;
  searching: boolean;
  notice: { tone: "info" | "error"; message: string } | null;
  onJobTitleChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onDismissNotice: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const disabledReason = companySearchDisabledReason(quota, searching);
  // The dialog mounts on open — move focus straight into the first field so
  // opening never strands keyboard focus on nothing.
  const roleInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    roleInputRef.current?.focus();
  }, []);
  // The submit lives in the footer, outside the <form>, so it targets the form
  // by id — Enter in either field and the footer button share one submit path.
  const formId = `${panelId}-form`;
  return (
    <div className={styles.modalOverlay} role="presentation">
      <div
        id={panelId}
        className={`card ${styles.modalCard} ${styles.companySearchCard}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discover-company-search-title"
        aria-describedby="discover-company-search-subtitle"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !searching) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className={styles.companySearchHead}>
          <span className={styles.companySearchIconTile} aria-hidden="true">
            <Search />
          </span>
          <div className={styles.companySearchHeadCopy}>
            <h2 id="discover-company-search-title" className={styles.panelTitle}>
              {COMPANY_SEARCH_TITLE}
            </h2>
            <p id="discover-company-search-subtitle" className={styles.panelSubtitle}>
              {COMPANY_SEARCH_SUBTITLE}
            </p>
          </div>
          <CircularCloseButton label={COMPANY_SEARCH_CLOSE_LABEL} onClick={onClose} disabled={searching} />
        </div>
        <form
          id={formId}
          className={styles.companySearchForm}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{COMPANY_SEARCH_ROLE_LABEL}</span>
            <input
              ref={roleInputRef}
              className={styles.input}
              value={jobTitle}
              onChange={(event) => onJobTitleChange(event.target.value)}
              placeholder={COMPANY_SEARCH_ROLE_PLACEHOLDER}
              aria-label={COMPANY_SEARCH_ROLE_LABEL}
              disabled={searching}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{COMPANY_SEARCH_LOCATION_LABEL}</span>
            <input
              className={styles.input}
              value={location}
              onChange={(event) => onLocationChange(event.target.value)}
              placeholder={COMPANY_SEARCH_LOCATION_PLACEHOLDER}
              aria-label={COMPANY_SEARCH_LOCATION_LABEL}
              disabled={searching}
            />
          </label>
        </form>
        {notice && (
          <div
            className={`${styles.inlineAlert} ${notice.tone === "error" ? styles.inlineAlertError : ""}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            <AlertCircle aria-hidden="true" />
            <span>{notice.message}</span>
            <CircularCloseButton compact label="Dismiss" onClick={onDismissNotice} />
          </div>
        )}
        <p className={styles.fieldHint}>{COMPANY_SEARCH_HELPER}</p>
        <div className={styles.companySearchFooter}>
          <QuotaIndicator quota={quota} />
          <div className={styles.companySearchFooterActions}>
            <button type="button" className={styles.ghostButton} onClick={onClose} disabled={searching}>
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              className={`${styles.primaryButton} ${styles.companySearchSubmit}`}
              disabled={disabledReason !== null}
              title={disabledReason ?? undefined}
            >
              {searching ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Search aria-hidden="true" />}
              <span>{searching ? COMPANY_SEARCH_LOADING_LABEL : COMPANY_SEARCH_BUTTON_LABEL}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  search,
  quota,
  processing,
  onProcess,
  onCancel
}: {
  search: ProspectSearchNode;
  quota: DiscoverQuota | null;
  processing: boolean;
  onProcess: () => void;
  onCancel: () => void;
}) {
  const badge = statusBadge(search.status);
  const failed = search.status === "FAILED";
  const canceled = search.status === "CANCELED";
  const error = failed ? formatSearchError(search) : null;
  const perSearch = quota?.resultsPerSearch ?? 10;
  const quotaBlocked = isProcessQuotaBlocked(quota, search.status);
  const resetLabel = formatQuotaReset(quota);
  return (
    <div className={`card ${styles.statusCard}`} data-discover-tour="status-summary">
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
        <>
          <p className={styles.statusBody}>
            <strong>{error?.title}</strong>
          </p>
          <p className={styles.statusBody}>{error?.message}</p>
        </>
      ) : canceled ? (
        <p className={styles.statusBody}>This search was canceled. Create a new one to discover people.</p>
      ) : quotaBlocked ? (
        <p className={styles.statusBody}>
          You&apos;ve used today&apos;s {quota?.dailySearchLimit ?? 4} Discover searches.
          {resetLabel ? ` ${resetLabel}.` : ""}
        </p>
      ) : (
        <p className={styles.statusBody}>
          This search is still a draft. Run Process to resolve the company and discover up to {perSearch} people.
        </p>
      )}
      <div className={styles.statusActions}>
        {!canceled && (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onProcess}
            disabled={processing || quotaBlocked}
            data-discover-tour="process-action"
          >
            {processing ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : null}
            {failed
              ? processing
                ? "Retrying search…"
                : "Retry search"
              : processing
                ? "Processing…"
                : "Process search"}
          </button>
        )}
        {failed && (
          <Link href="/prospects" className={styles.secondaryButton}>
            Back to Discover
          </Link>
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
    <div className={styles.bulkToolbar} data-discover-tour="bulk-actions">
      <strong>{selectedCount} selected</strong>
      <div className={styles.bulkActions}>
        <button type="button" className={styles.secondaryButton} onClick={onDownload} disabled={busy}>
          <Download aria-hidden="true" />
          <span>Export</span>
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onImport} disabled={busy}>
          <FileSpreadsheet aria-hidden="true" />
          <span>Import</span>
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
  const buttonLabel = categoryName
    ? `Select all ${totalCount} ${categoryName} prospects`
    : `Select all ${totalCount} people`;
  return (
    <div className={styles.selectAllBanner} role="status" data-discover-tour="select-all">
      <span className={styles.selectAllMessage}>All {pageCount} people on this page are selected.</span>
      <button
        type="button"
        className={styles.selectAllButton}
        onClick={onSelectAll}
        aria-label={
          categoryName
            ? `Select all ${totalCount} ${categoryName} prospects in this search`
            : `Select all ${totalCount} people in this search`
        }
      >
        {buttonLabel}
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
  filtersActive,
  onClearFilters,
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
  filtersActive: boolean;
  onClearFilters: () => void;
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
    // With active role/location filters the empty state names them and offers a
    // one-click reset — never a blank table.
    if (filtersActive) {
      return (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title={FILTERED_PEOPLE_EMPTY_TITLE}
          body={FILTERED_PEOPLE_EMPTY_BODY}
          compact
          action={
            <button type="button" className={styles.secondaryButton} onClick={onClearFilters}>
              {CLEAR_FILTERS_LABEL}
            </button>
          }
        />
      );
    }
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
        <span role="columnheader" className={styles.cellSelect} data-discover-tour="people-selection">
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
              <span className={styles.personName} title={person.fullName}>
                {person.fullName}
              </span>
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
                    data-discover-tour="copy-email"
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
                data-discover-tour="profile-link"
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

function AddMorePeopleDialog({
  open,
  peopleCount,
  quota,
  expanding,
  target,
  onConfirm,
  onClose
}: {
  open: boolean;
  peopleCount: number;
  quota: DiscoverQuota | null;
  expanding: boolean;
  target: AddMoreTarget;
  onConfirm: (targetSearchId: string) => void;
  onClose: () => void;
}) {
  // When several role searches exist and no role tab pins the target, the user
  // must explicitly choose which search to extend — we never guess, and we
  // never add a batch to every role at once.
  const [chosenSearchId, setChosenSearchId] = useState<string>("");
  useEffect(() => {
    if (open) {
      setChosenSearchId(target.kind === "choose" ? target.options[0]?.id ?? "" : "");
    }
  }, [open, target]);

  if (!open) {
    return null;
  }

  const resolvedSearchId =
    target.kind === "search" ? target.search.id : target.kind === "choose" ? chosenSearchId : "";

  return (
    <div className={styles.modalOverlay} role="presentation">
      <div
        className={`card ${styles.modalCard} ${styles.addMoreCard}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discover-add-more-title"
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 id="discover-add-more-title" className={styles.panelTitle}>
              {ADD_MORE_DIALOG_TITLE}
            </h2>
            <p className={styles.panelSubtitle}>{ADD_MORE_DIALOG_BODY}</p>
          </div>
          <CircularCloseButton label="Close" onClick={onClose} disabled={expanding} />
        </div>

        {target.kind === "choose" && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Role group</span>
            <select
              className={`${styles.input} ${styles.selectField}`}
              value={chosenSearchId}
              onChange={(event) => setChosenSearchId(event.target.value)}
              disabled={expanding}
              aria-label="Role group to extend"
            >
              {target.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {addMoreSearchLabel(option)}
                </option>
              ))}
            </select>
            <span className={styles.fieldHint}>{ADD_MORE_CHOOSE_ROLE_HINT}</span>
          </label>
        )}
        {target.kind === "search" && (
          <dl className={styles.reviewGrid}>
            <div>
              <dt>Role group</dt>
              <dd>{addMoreSearchLabel(target.search)}</dd>
            </div>
          </dl>
        )}

        <dl className={styles.reviewGrid}>
          <div>
            <dt>Current people</dt>
            <dd>{Math.max(0, peopleCount)}</dd>
          </div>
          <div>
            <dt>Searches remaining today</dt>
            <dd>{quota && !quota.unlimited ? quota.searchesRemaining : "Unlimited"}</dd>
          </div>
        </dl>

        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose} disabled={expanding}>
            {ADD_MORE_CANCEL_LABEL}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => resolvedSearchId && onConfirm(resolvedSearchId)}
            disabled={expanding || !resolvedSearchId}
          >
            {expanding ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <UserPlus aria-hidden="true" />}
            <span>{expanding ? ADD_MORE_LOADING_LABEL : ADD_MORE_CONFIRM_LABEL}</span>
          </button>
        </div>
      </div>
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
  // The modal is action-specific: an export opens an export-only dialog and an
  // import opens an import-only dialog — never both actions at once.
  const isExport = intent === "download";
  const title = isExport ? "Review export" : "Review import";
  const ConfirmIcon = isExport ? Download : FileSpreadsheet;
  const confirmBusy = isExport ? preparingExport : creatingImport;
  const confirmBusyLabel = isExport ? "Preparing Excel file…" : "Creating import…";
  const confirmLabel = isExport ? `Export ${exportableCount} records` : `Import ${exportableCount} records`;
  const onConfirm = isExport ? onDownload : onImport;

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
          <CircularCloseButton label="Close" onClick={onClose} disabled={busy} />
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
          <div className={styles.reviewActionGroup}>
            <button type="button" className={styles.primaryButton} onClick={onConfirm} disabled={busy || exportableCount <= 0}>
              {confirmBusy ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <ConfirmIcon aria-hidden="true" />}
              <span>{confirmBusy ? confirmBusyLabel : confirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className={`card ${styles.qualityCard}`}>
        <div className={styles.skeletonLine} style={{ width: "32%" }} />
        <div className={styles.skeletonLine} style={{ width: "100%" }} />
        <div className={styles.skeletonLine} style={{ width: "55%" }} />
      </div>
      <div className={`card ${styles.companyCard}`}>
        <div className={styles.skeletonLine} style={{ width: "32%" }} />
        <div className={styles.skeletonLine} style={{ width: "55%" }} />
      </div>
      <div className={`card ${styles.peopleSection}`}>
        <div className={styles.tableSkeleton}>
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className={styles.skeletonRow} />
          ))}
        </div>
      </div>
    </>
  );
}
