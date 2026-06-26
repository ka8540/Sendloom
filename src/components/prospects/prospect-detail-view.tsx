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
  Users
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
  ADD_MORE_CONFIRM_LABEL,
  ADD_MORE_DIALOG_BODY,
  ADD_MORE_DIALOG_TITLE,
  ADD_MORE_LOADING_LABEL,
  ADD_MORE_PEOPLE_LABEL,
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  addMoreDisabledReason,
  buildProspectSelectionInput,
  confidenceBadge,
  createEmptyProspectSelection,
  emailStatusBadge,
  filterPeopleByText,
  formatDateTime,
  formatPageLabel,
  formatQuotaReset,
  formatSearchError,
  formatShowingLabel,
  getPageSelectionState,
  getProspectSelectionCount,
  isEmailCopyable,
  isProcessQuotaBlocked,
  isProspectSelected,
  personLocation,
  resolvePageCount,
  resolveSelectedSearchView,
  selectAllMatchingProspects,
  shouldShowAddMore,
  statusBadge,
  togglePageProspectSelection,
  toggleProspectSelection,
  type PageSelectionState,
  type ProspectSelectionState
} from "@/components/prospects/prospect-view";
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
  const [expanding, setExpanding] = useState(false);
  const [showAddMoreDialog, setShowAddMoreDialog] = useState(false);
  const [sessionExhausted, setSessionExhausted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [companyPendingDeletion, setCompanyPendingDeletion] = useState<CompanyDetail | null>(null);
  const [deleteCompanyError, setDeleteCompanyError] = useState<string | null>(null);
  const [refreshingFormat, setRefreshingFormat] = useState(false);
  const [formatSourceUrl, setFormatSourceUrl] = useState("");
  const [showFormatSource, setShowFormatSource] = useState(false);
  const [showManualFormat, setShowManualFormat] = useState(false);
  const [manualEmailDomain, setManualEmailDomain] = useState("");
  const [manualEmailPattern, setManualEmailPattern] = useState("first.last");
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

  // Load the search by route id, then its company + people when it is READY.
  // Preserves the active category on a silent refresh (keeps the current view).
  const loadDetail = useCallback(
    async (options: { category?: PositionCategory | null } = {}) => {
      const category = options.category ?? null;
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
        await loadPeople({ companyId: node.company.id, category, pageIndex: 0, after: null });
      } else {
        setCompany(null);
        resetPeopleState();
      }
    },
    [loadCompany, loadPeople, resetPeopleState, searchId]
  );

  useEffect(() => {
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
    void loadDetail({ category: activeCategory });
    void loadQuota();
  }, [activeCategory, loadDetail, loadQuota]);

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
      await loadPeople({ companyId: updatedCompany.id, category: activeCategory, pageIndex: 0, after: null });
    },
    [activeCategory, loadPeople]
  );

  const handleAddMore = useCallback(async () => {
    if (!search || search.status !== "READY" || !search.company || expanding) {
      return;
    }
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${search.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setShowAddMoreDialog(false);
    setExpanding(true);
    setActionError(null);
    setActionNotice(null);

    const result = await prospectGraphql<{ addMoreDiscoverPeople: DiscoverSearchExpansion }>(
      ADD_MORE_DISCOVER_PEOPLE_MUTATION,
      { searchId: search.id, idempotencyKey }
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
    if (expansion.exhausted) {
      setSessionExhausted(true);
    }
    setActionNotice({ message: expansion.message ?? `${expansion.addedCount} new people were added.` });

    // Refresh counts + people in place (new people land on later pages).
    if (search.company) {
      peopleAfterCursors.current = [null];
      await loadCompany(search.company.id);
      await loadPeople({ companyId: search.company.id, category: activeCategory, pageIndex: 0, after: null });
    }
    await loadDetail({ category: activeCategory });
  }, [activeCategory, expanding, loadCompany, loadDetail, loadPeople, loadQuota, search]);

  const handleRefreshEmailFormat = useCallback(
    async (target: CompanyDetail, sourceUrl?: string | null) => {
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
      setRefreshingFormat(true);
      setActionError(null);
      setActionNotice(null);
      const result = await prospectGraphql<{ discoverCompanyEmailFormat: CompanyDetail }>(
        DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
        { companyId: target.id, force }
      );
      setRefreshingFormat(false);
      if (result.disabled) {
        setDisabled(true);
        return;
      }
      if (result.error || !result.data) {
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

  const roleLabel = search.requestedTitles.length > 0 ? search.requestedTitles.join(", ") : "Any role";
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
          </div>
        </div>
        <div className={styles.headerActions}>
          <QuotaIndicator quota={quota} />
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

      <SummaryCards search={search} company={company} view={selectedView} />

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
          <CompanyCard
            company={company}
            loading={companyLoading}
            deleting={Boolean(company && deleting)}
            refreshingFormat={Boolean(company && refreshingFormat)}
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

              <div className={styles.categoryRail} role="tablist" aria-label="Role groups" data-discover-tour="role-filters">
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
      <div className={`card ${styles.summaryCard}`} data-discover-tour="company-summary">
        <span className={styles.summaryLabel}>
          <Building2 aria-hidden="true" /> Company
        </span>
        <span className={styles.summaryValue}>{company?.name ?? search?.company?.name ?? search?.requestedCompany ?? "—"}</span>
        <span className={styles.summaryMeta}>Website: {websiteDomain ?? "unresolved"}</span>
      </div>

      <div className={`card ${styles.summaryCard}`} data-discover-tour="people-summary">
        <span className={styles.summaryLabel}>
          <Users aria-hidden="true" /> People found
        </span>
        <span className={styles.summaryValue}>{peopleCount}</span>
        <span className={styles.summaryMeta}>
          {positionCount > 0 ? `${positionCount} position groups` : "Position groups appear when ready"}
        </span>
      </div>

      <div className={`card ${styles.summaryCard}`} data-discover-tour="email-format-summary">
        <span className={styles.summaryLabel}>
          <AtSign aria-hidden="true" /> Email format
        </span>
        <span className={styles.summaryValue}>{emailDomain ?? "Unavailable"}</span>
        <span className={styles.summaryMeta}>
          {pattern ? <code className={styles.patternCode}>{pattern}</code> : "Pattern unavailable"}
        </span>
        {emailDomain && pattern ? (
          <span className={styles.summaryWarn}>
            Inferred ·{" "}
            {confidenceBadge(
              emailDomainConfidence === "UNAVAILABLE" ? patternConfidence : emailDomainConfidence
            ).label.toLowerCase()}{" "}
            confidence, not verified
          </span>
        ) : (
          <span className={styles.summaryMeta}>Email inference unavailable</span>
        )}
        {domainDiffers && <span className={styles.summaryMeta}>Website differs from email domain</span>}
      </div>

      <div className={`card ${styles.summaryCard}`} data-discover-tour="status-summary">
        <span className={styles.summaryLabel}>
          <Sparkles aria-hidden="true" /> Search status
        </span>
        <span className={styles.summaryValue}>{status ? <BadgePill badge={status} /> : "—"}</span>
        <span className={styles.summaryMeta}>
          {view === "ready" && search?.completedAt
            ? `Completed ${formatDateTime(search.completedAt)}`
            : `Created ${formatDateTime(search?.createdAt ?? null)}`}
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
    <div className={`card ${styles.companyCard}`} data-discover-tour="company-details">
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
          data-discover-tour="delete-search"
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
            data-discover-tour="refresh-ai"
          >
            {refreshingFormat ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Sparkles aria-hidden="true" />}
            <span>{hasEmailFormat ? "Refresh with AI" : "Find with AI"}</span>
          </button>
          <button type="button" className={styles.ghostButton} onClick={onToggleFormatSource} data-discover-tour="source-url">
            Use source URL
          </button>
          <button type="button" className={styles.ghostButton} onClick={onToggleManualFormat} data-discover-tour="manual-format">
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
    <div className={styles.selectAllBanner} role="status" data-discover-tour="select-all">
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
  onConfirm,
  onClose
}: {
  open: boolean;
  peopleCount: number;
  quota: DiscoverQuota | null;
  expanding: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className={styles.modalOverlay} role="presentation">
      <div className={`card ${styles.modalCard}`} role="dialog" aria-modal="true" aria-labelledby="discover-add-more-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="discover-add-more-title" className={styles.panelTitle}>
              {ADD_MORE_DIALOG_TITLE}
            </h2>
            <p className={styles.panelSubtitle}>{ADD_MORE_DIALOG_BODY}</p>
          </div>
          <CircularCloseButton label="Close" onClick={onClose} disabled={expanding} />
        </div>

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
          <button type="button" className={styles.primaryButton} onClick={onConfirm} disabled={expanding}>
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

function DetailSkeleton() {
  return (
    <>
      <div className={`card ${styles.companyCard}`}>
        <div className={styles.skeletonLine} style={{ width: "32%" }} />
        <div className={styles.skeletonLine} style={{ width: "55%" }} />
      </div>
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
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className={styles.skeletonRow} />
          ))}
        </div>
      </div>
    </>
  );
}
