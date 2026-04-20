"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HunterResultRow } from "@/lib/hunter";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Globe,
  KeyRound,
  LoaderCircle,
  Mail,
  Search,
  Settings2,
  X,
  UserRound
} from "lucide-react";
import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import styles from "@/components/hunter-dashboard.module.css";

type HunterKeyStatus = {
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
};

type HunterDomainSearchSummary = {
  id: string;
  domain: string;
  resultCount: number;
  updatedAt: string;
};

type HunterDomainSearchDetail = HunterDomainSearchSummary & {
  results: HunterResultRow[];
};

type SearchTab = "finder" | "domain";

type Props = {
  initialKeyStatus: HunterKeyStatus;
  initialDomainSearchHistory: HunterDomainSearchSummary[];
};

const RESULTS_PAGE_SIZE = 10;
const SAVED_DOMAIN_SEARCHES_PAGE_SIZE = 10;
const LOCAL_STORAGE_SAVED_DOMAIN_SEARCHES_KEY = "sendloom_hunter_domain_searches";
const DOMAIN_CATEGORY_ORDER = ["IT", "HR", "Sales", "Marketing", "Operations", "Finance", "Leadership", "Other"] as const;
type DomainCategory = (typeof DOMAIN_CATEGORY_ORDER)[number];
type DomainSearchResultRow = HunterResultRow & {
  department: DomainCategory;
  selectionKey: string;
};

function splitFullName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function formatUpdatedAt(updatedAt: string | null) {
  if (!updatedAt) {
    return null;
  }

  return new Date(updatedAt).toLocaleString();
}

function formatSavedDomainSearchUpdatedAt(updatedAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(updatedAt));
}

function getSavedDomainSearchDomainKey(domain: string) {
  return domain.trim().toLowerCase();
}

function createLocalSavedDomainSearchId(domain: string) {
  return `local:${getSavedDomainSearchDomainKey(domain)}`;
}

function isHunterResultRow(value: unknown): value is HunterResultRow {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as HunterResultRow).email === "string" &&
      typeof (value as HunterResultRow).name === "string" &&
      typeof (value as HunterResultRow).source === "string" &&
      ((value as HunterResultRow).position === null || typeof (value as HunterResultRow).position === "string") &&
      ((value as HunterResultRow).confidence === null || typeof (value as HunterResultRow).confidence === "number")
  );
}

function isHunterDomainSearchDetail(value: unknown): value is HunterDomainSearchDetail {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as HunterDomainSearchDetail).id === "string" &&
      typeof (value as HunterDomainSearchDetail).domain === "string" &&
      typeof (value as HunterDomainSearchDetail).updatedAt === "string" &&
      (typeof (value as HunterDomainSearchDetail).resultCount === "number" ||
        typeof (value as Partial<HunterDomainSearchDetail>).resultCount === "undefined") &&
      Array.isArray((value as HunterDomainSearchDetail).results) &&
      (value as HunterDomainSearchDetail).results.every(isHunterResultRow)
  );
}

function toHunterDomainSearchSummary(detail: HunterDomainSearchDetail): HunterDomainSearchSummary {
  return {
    id: detail.id,
    domain: detail.domain,
    resultCount: typeof detail.resultCount === "number" ? detail.resultCount : detail.results.length,
    updatedAt: detail.updatedAt
  };
}

function mergeHunterDomainSearchSummaries(...collections: HunterDomainSearchSummary[][]) {
  const merged = new Map<string, HunterDomainSearchSummary>();

  for (const collection of collections) {
    for (const search of collection) {
      const key = getSavedDomainSearchDomainKey(search.domain);
      const existing = merged.get(key);

      if (!existing || new Date(search.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
        merged.set(key, search);
      }
    }
  }

  return Array.from(merged.values()).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function readLocalSavedDomainSearches() {
  if (typeof window === "undefined") {
    return [] as HunterDomainSearchDetail[];
  }

  try {
    const rawValue = window.localStorage.getItem(LOCAL_STORAGE_SAVED_DOMAIN_SEARCHES_KEY);
    if (!rawValue) {
      return [] as HunterDomainSearchDetail[];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [] as HunterDomainSearchDetail[];
    }

    return parsed.filter(isHunterDomainSearchDetail);
  } catch {
    return [] as HunterDomainSearchDetail[];
  }
}

function writeLocalSavedDomainSearches(searches: HunterDomainSearchDetail[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LOCAL_STORAGE_SAVED_DOMAIN_SEARCHES_KEY, JSON.stringify(searches));
}

function inferHunterCategory(position: string | null): DomainCategory {
  const value = position?.toLowerCase().trim() ?? "";

  if (!value) {
    return "Other";
  }

  if (
    /\b(hr|human resources|people|talent|recruit(er|ing)|sourcer|people ops)\b/.test(value)
  ) {
    return "HR";
  }

  if (
    /\b(sales|account executive|account manager|business development|partnerships|revenue)\b/.test(value)
  ) {
    return "Sales";
  }

  if (/\b(marketing|growth|brand|communications|content|demand gen)\b/.test(value)) {
    return "Marketing";
  }

  if (/\b(finance|accountant|controller|cfo|bookkeeper|procurement|payroll)\b/.test(value)) {
    return "Finance";
  }

  if (/\b(operations|ops|customer success|support|program manager|project manager)\b/.test(value)) {
    return "Operations";
  }

  if (/\b(chief|founder|ceo|cto|coo|president|vice president|vp\b|director|head of)\b/.test(value)) {
    return "Leadership";
  }

  if (
    /\b(engineer|engineering|developer|software|architect|data|devops|platform|security|technical|it\b|infrastructure)\b/.test(value)
  ) {
    return "IT";
  }

  return "Other";
}

function getDomainSearchSelectionKey(row: HunterResultRow) {
  return `${row.email.trim().toLowerCase()}::${row.source.trim().toLowerCase()}`;
}

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = value == null ? "" : String(value);
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

export function HunterDashboard({ initialKeyStatus, initialDomainSearchHistory }: Props) {
  const { showError } = useErrorToast();
  const [activeTab, setActiveTab] = useState<SearchTab>("finder");
  const [keyStatus, setKeyStatus] = useState(initialKeyStatus);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [finderDomain, setFinderDomain] = useState("");
  const [searchDomain, setSearchDomain] = useState("");

  const [results, setResults] = useState<HunterResultRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [domainPages, setDomainPages] = useState<Record<string, number>>({});
  const [selectedDomainCategory, setSelectedDomainCategory] = useState<DomainCategory | null>(null);
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(() => new Set());
  const [savedDomainSearches, setSavedDomainSearches] = useState(initialDomainSearchHistory);
  const [savedDomainSearchPage, setSavedDomainSearchPage] = useState(0);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const [savedSearchPendingId, setSavedSearchPendingId] = useState<string | null>(null);
  const [savedDomainSearchDetailsByDomain, setSavedDomainSearchDetailsByDomain] = useState<
    Record<string, HunterDomainSearchDetail>
  >({});
  useErrorToastEffect(error, "Hunter search failed");
  useErrorToastEffect(settingsError, "Hunter settings failed");

  const statusCopy = useMemo(() => {
    if (!keyStatus.configured) {
      return "No Hunter API key saved yet.";
    }

    const updated = formatUpdatedAt(keyStatus.updatedAt);
    return updated ? `Saved key ••••${keyStatus.last4 ?? "----"} updated ${updated}` : `Saved key ••••${keyStatus.last4 ?? "----"}`;
  }, [keyStatus]);

  const applyDomainSearchResults = useCallback(
    (domain: string, nextResults: HunterResultRow[], savedSearchId?: string | null) => {
      setSearchDomain(domain);
      setActiveTab("domain");
      setResults(nextResults);
      setHasSearched(true);
      setError(null);
      setDomainPages({});
      setSelectedDomainCategory(null);
      setSelectedContactKeys(new Set());
      setActiveSavedSearchId(savedSearchId ?? null);
    },
    []
  );

  const clearActiveSavedDomainSearch = useCallback(() => {
    setResults([]);
    setHasSearched(false);
    setError(null);
    setDomainPages({});
    setSelectedDomainCategory(null);
    setSelectedContactKeys(new Set());
    setActiveSavedSearchId(null);
  }, []);

  const cacheSavedDomainSearch = useCallback((savedSearch: HunterDomainSearchDetail) => {
    const domainKey = getSavedDomainSearchDomainKey(savedSearch.domain);

    setSavedDomainSearchDetailsByDomain((current) => ({
      ...current,
      [domainKey]: savedSearch
    }));
    setSavedDomainSearches((current) => mergeHunterDomainSearchSummaries(current, [toHunterDomainSearchSummary(savedSearch)]));
    setSavedDomainSearchPage(0);

    const localSearches = readLocalSavedDomainSearches();
    const nextLocalSearches = [
      savedSearch,
      ...localSearches.filter((entry) => getSavedDomainSearchDomainKey(entry.domain) !== domainKey)
    ]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 25);

    writeLocalSavedDomainSearches(nextLocalSearches);
  }, []);

  async function handleSaveApiKey() {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setSettingsError("Enter your Hunter API key first.");
      return;
    }

    setSettingsPending(true);
    setSettingsError(null);

    try {
      const response = await fetch("/api/save-api-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ apiKey: trimmedKey })
      });

      const payload = (await response.json().catch(() => null)) as HunterKeyStatus & { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save your Hunter API key.");
      }

      setKeyStatus({
        configured: payload?.configured ?? true,
        last4: payload?.last4 ?? null,
        updatedAt: payload?.updatedAt ?? null
      });
      setApiKey("");
      setIsSettingsOpen(false);
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Could not save your Hunter API key.");
    } finally {
      setSettingsPending(false);
    }
  }

  async function runSearch(endpoint: "/api/email-finder" | "/api/domain-search", payload: Record<string, string>) {
    setPending(true);
    setError(null);
    setHasSearched(true);
    setResults([]);
    setDomainPages({});
    setSelectedDomainCategory(null);
    setSelectedContactKeys(new Set());
    setActiveSavedSearchId(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => null)) as { error?: string; results?: HunterResultRow[] } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Hunter search failed.");
      }

      setResults(data?.results ?? []);
    } catch (searchError) {
      setHasSearched(false);
      setError(searchError instanceof Error ? searchError.message : "Hunter search failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleFindEmail() {
    const parsedName = splitFullName(fullName);
    if (!parsedName) {
      setHasSearched(false);
      setError("Enter a full name with both first and last name.");
      return;
    }

    if (!finderDomain.trim()) {
      setHasSearched(false);
      setError("Enter a company domain like stripe.com.");
      return;
    }

    await runSearch("/api/email-finder", {
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      domain: finderDomain.trim()
    });
  }

  async function handleDomainSearch() {
    if (!searchDomain.trim()) {
      setHasSearched(false);
      setError("Enter a company domain like stripe.com.");
      return;
    }

    setPending(true);
    setError(null);
    setHasSearched(true);
    setResults([]);
    setDomainPages({});
    setSelectedDomainCategory(null);
    setSelectedContactKeys(new Set());

    try {
      const response = await fetch("/api/domain-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          domain: searchDomain.trim()
        })
      });

      const data = (await response.json().catch(() => null)) as
        | {
            error?: string;
            results?: HunterResultRow[];
            savedSearch?: HunterDomainSearchSummary;
          }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Hunter search failed.");
      }

      const nextResults = data?.results ?? [];
      const savedSearchDetail: HunterDomainSearchDetail = {
        id: data?.savedSearch?.id ?? createLocalSavedDomainSearchId(data?.savedSearch?.domain ?? searchDomain.trim()),
        domain: data?.savedSearch?.domain ?? searchDomain.trim(),
        resultCount: nextResults.length,
        updatedAt: data?.savedSearch?.updatedAt ?? new Date().toISOString(),
        results: nextResults
      };

      applyDomainSearchResults(savedSearchDetail.domain, nextResults);
      cacheSavedDomainSearch(savedSearchDetail);
    } catch (searchError) {
      setHasSearched(false);
      setActiveSavedSearchId(null);
      setError(searchError instanceof Error ? searchError.message : "Hunter search failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleCopy(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      window.setTimeout(() => {
        setCopiedEmail((current) => (current === email ? null : current));
      }, 1400);
    } catch {
      showError("Could not copy that email. Try again.", { title: "Copy failed" });
    }
  }

  const domainSearchRows = useMemo<DomainSearchResultRow[]>(() => {
    return results.map((row) => ({
      ...row,
      department: inferHunterCategory(row.position),
      selectionKey: getDomainSearchSelectionKey(row)
    }));
  }, [results]);

  const savedDomainSearchTotalPages = Math.max(1, Math.ceil(savedDomainSearches.length / SAVED_DOMAIN_SEARCHES_PAGE_SIZE));

  const pagedSavedDomainSearches = useMemo(() => {
    const startIndex = savedDomainSearchPage * SAVED_DOMAIN_SEARCHES_PAGE_SIZE;
    return savedDomainSearches.slice(startIndex, startIndex + SAVED_DOMAIN_SEARCHES_PAGE_SIZE);
  }, [savedDomainSearchPage, savedDomainSearches]);

  const groupedDomainResults = useMemo(() => {
    if (activeTab !== "domain") {
      return [];
    }

    const grouped = new Map<DomainCategory, DomainSearchResultRow[]>();
    for (const category of DOMAIN_CATEGORY_ORDER) {
      grouped.set(category, []);
    }

    for (const row of domainSearchRows) {
      grouped.get(row.department)?.push(row);
    }

    return DOMAIN_CATEGORY_ORDER.map((category) => {
      const rows = grouped.get(category) ?? [];
      const totalPages = Math.max(1, Math.ceil(rows.length / RESULTS_PAGE_SIZE));
      const currentPage = Math.min(domainPages[category] ?? 1, totalPages);
      const startIndex = (currentPage - 1) * RESULTS_PAGE_SIZE;

      return {
        category,
        rows,
        currentPage,
        totalPages,
        visibleRows: rows.slice(startIndex, startIndex + RESULTS_PAGE_SIZE)
      };
    }).filter((group) => group.rows.length > 0);
  }, [activeTab, domainPages, domainSearchRows]);

  useEffect(() => {
    if (activeTab !== "domain") {
      return;
    }

    if (!groupedDomainResults.length) {
      setSelectedDomainCategory(null);
      return;
    }

    setSelectedDomainCategory((current) => {
      if (current && groupedDomainResults.some((group) => group.category === current)) {
        return current;
      }

      return groupedDomainResults[0]?.category ?? null;
    });
  }, [activeTab, groupedDomainResults]);

  useEffect(() => {
    setSavedDomainSearchPage((current) => Math.min(current, Math.max(0, savedDomainSearchTotalPages - 1)));
  }, [savedDomainSearchTotalPages]);

  useEffect(() => {
    const localSavedSearches = readLocalSavedDomainSearches();
    const localDetailsByDomain = Object.fromEntries(
      localSavedSearches.map((search) => [getSavedDomainSearchDomainKey(search.domain), search])
    );

    setSavedDomainSearches((current) =>
      mergeHunterDomainSearchSummaries(
        current,
        localSavedSearches.map(toHunterDomainSearchSummary)
      )
    );
    setSavedDomainSearchDetailsByDomain(localDetailsByDomain);
  }, []);

  const activeDomainGroup =
    activeTab === "domain"
      ? groupedDomainResults.find((group) => group.category === selectedDomainCategory) ?? groupedDomainResults[0] ?? null
      : null;

  const selectedContacts = useMemo(() => {
    const selected = new Map<string, DomainSearchResultRow>();

    for (const row of domainSearchRows) {
      if (selectedContactKeys.has(row.selectionKey) && !selected.has(row.selectionKey)) {
        selected.set(row.selectionKey, row);
      }
    }

    return Array.from(selected.values());
  }, [domainSearchRows, selectedContactKeys]);

  const selectedCount = selectedContacts.length;
  const searchDisabled = pending || !keyStatus.configured;

  const toggleContactSelection = useCallback((selectionKey: string) => {
    setSelectedContactKeys((current) => {
      const next = new Set(current);

      if (next.has(selectionKey)) {
        next.delete(selectionKey);
      } else {
        next.add(selectionKey);
      }

      return next;
    });
  }, []);

  const handleExportSelectedContacts = useCallback(() => {
    if (!selectedContacts.length) {
      showError("No contacts selected", { title: "Export unavailable" });
      return;
    }

    const csvLines = [
      ["Name", "Email", "Position", "Department", "Confidence", "Source"].join(","),
      ...selectedContacts.map((row) =>
        [
          escapeCsvValue(row.name || "Unknown contact"),
          escapeCsvValue(row.email),
          escapeCsvValue(row.position ?? ""),
          escapeCsvValue(row.department),
          escapeCsvValue(typeof row.confidence === "number" ? `${row.confidence}%` : ""),
          escapeCsvValue(row.source)
        ].join(",")
      )
    ];

    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `contacts_export_${timestamp}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  }, [selectedContacts, showError]);

  const loadSavedDomainSearch = useCallback(
    async (savedSearch: HunterDomainSearchSummary, options?: { silent?: boolean }) => {
      setSavedSearchPendingId(savedSearch.id);
      setError(null);

      const cachedDetail = savedDomainSearchDetailsByDomain[getSavedDomainSearchDomainKey(savedSearch.domain)];
      if (cachedDetail) {
        applyDomainSearchResults(cachedDetail.domain, cachedDetail.results, cachedDetail.id);
        setSavedSearchPendingId(null);
        return;
      }

      try {
        const response = await fetch(`/api/domain-search/${encodeURIComponent(savedSearch.id)}`);
        const payload = (await response.json().catch(() => null)) as
          | ({
              error?: string;
            } & Partial<HunterDomainSearchDetail>)
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Could not load that saved domain search.");
        }

        const savedSearchDetail: HunterDomainSearchDetail = {
          id: payload?.id ?? savedSearch.id,
          domain: payload?.domain ?? savedSearch.domain,
          resultCount: payload?.resultCount ?? (payload?.results?.length ?? savedSearch.resultCount),
          updatedAt: payload?.updatedAt ?? savedSearch.updatedAt,
          results: payload?.results ?? []
        };

        cacheSavedDomainSearch(savedSearchDetail);
        applyDomainSearchResults(savedSearchDetail.domain, savedSearchDetail.results, savedSearchDetail.id);
      } catch (loadError) {
        if (!options?.silent) {
          showError(loadError instanceof Error ? loadError.message : "Could not load that saved domain search.", {
            title: "Saved search failed"
          });
        }
      } finally {
        setSavedSearchPendingId(null);
      }
    },
    [applyDomainSearchResults, cacheSavedDomainSearch, savedDomainSearchDetailsByDomain, showError]
  );

  return (
    <>
      <div className={styles.page}>
        <section className={`hero ${styles.hero}`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Prospecting workspace</p>
            <h1>Email Finder</h1>
            <p className="muted">
              Use Hunter through a secure backend proxy to find one contact by name or search an entire company domain without
              exposing your API key in the browser.
            </p>
          </div>
          <div className={styles.heroActions}>
            <div className={styles.keyStatus}>
              <span className={`${styles.keyDot} ${keyStatus.configured ? styles.keyDotReady : styles.keyDotMissing}`} aria-hidden="true" />
              <span>{statusCopy}</span>
            </div>
            <button className="button secondary" type="button" onClick={() => setIsSettingsOpen(true)}>
              <Settings2 aria-hidden="true" />
              Hunter settings
            </button>
          </div>
        </section>

        <section className={`card ${styles.workspace}`}>
          <div className={styles.tabRow} role="tablist" aria-label="Hunter search modes">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "finder"}
              className={`${styles.tabButton} ${activeTab === "finder" ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setActiveTab("finder");
                setError(null);
              }}
            >
              <UserRound aria-hidden="true" />
              Find Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "domain"}
              className={`${styles.tabButton} ${activeTab === "domain" ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setActiveTab("domain");
                setError(null);
              }}
            >
              <Globe aria-hidden="true" />
              Domain Search
            </button>
          </div>

          {!keyStatus.configured ? (
            <div className={styles.callout}>
              <div>
                <strong>Add your Hunter API key to get started.</strong>
                <p className="muted">The key is stored server-side in encrypted form and never exposed to the frontend.</p>
              </div>
              <button className="button" type="button" onClick={() => setIsSettingsOpen(true)}>
                <KeyRound aria-hidden="true" />
                Add API key
              </button>
            </div>
          ) : null}

          <div className={styles.panelGrid}>
            <article className={styles.formPanel}>
              {activeTab === "finder" ? (
                <>
                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Find a specific email</h2>
                      <p className="muted">Match one person against a company domain using full name plus domain.</p>
                    </div>
                  </div>
                  <div className="form">
                    <div className="field">
                      <label htmlFor="finder-full-name">Full name</label>
                      <input
                        id="finder-full-name"
                        placeholder="Alexis Ohanian"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="finder-domain">Domain</label>
                      <input
                        id="finder-domain"
                        placeholder="reddit.com"
                        value={finderDomain}
                        onChange={(event) => setFinderDomain(event.target.value)}
                      />
                    </div>
                    <button className="button" type="button" onClick={handleFindEmail} disabled={searchDisabled}>
                      {pending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Mail aria-hidden="true" />}
                      Find Email
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Search a company domain</h2>
                      <p className="muted">Return all Hunter matches found for a domain with confidence and role data.</p>
                    </div>
                  </div>
                  <div className="form">
                    <div className="field">
                      <label htmlFor="domain-search-domain">Domain</label>
                      <input
                        id="domain-search-domain"
                        placeholder="stripe.com"
                        value={searchDomain}
                        onChange={(event) => setSearchDomain(event.target.value)}
                      />
                    </div>
                    <button className="button" type="button" onClick={handleDomainSearch} disabled={searchDisabled}>
                      {pending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Search aria-hidden="true" />}
                      Search
                    </button>
                  </div>
                </>
              )}

              {savedDomainSearches.length ? (
                <section className={styles.savedSearchSection} aria-label="Saved domain searches">
                  <div className={styles.savedSearchHeader}>
                    <div className={styles.savedSearchHeaderCopy}>
                      <strong>Saved domain searches</strong>
                      <p className="muted">Open a stored search any time and export contacts again.</p>
                    </div>

                    {savedDomainSearches.length > SAVED_DOMAIN_SEARCHES_PAGE_SIZE ? (
                      <div className={styles.resultsPager} aria-label="Saved domain search pages">
                        <button
                          type="button"
                          className={styles.resultsPagerButton}
                          onClick={() => setSavedDomainSearchPage((current) => Math.max(0, current - 1))}
                          disabled={savedDomainSearchPage === 0}
                          aria-label="Previous saved domain searches"
                        >
                          <ChevronLeft aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={styles.resultsPagerButton}
                          onClick={() =>
                            setSavedDomainSearchPage((current) => Math.min(savedDomainSearchTotalPages - 1, current + 1))
                          }
                          disabled={savedDomainSearchPage >= savedDomainSearchTotalPages - 1}
                          aria-label="Next saved domain searches"
                        >
                          <ChevronRight aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={styles.savedSearchRail}>
                    {pagedSavedDomainSearches.map((savedSearch) => (
                      <button
                        key={savedSearch.id}
                        type="button"
                        className={`${styles.savedSearchCard} ${
                          activeSavedSearchId === savedSearch.id ? styles.savedSearchCardActive : ""
                        }`}
                        onClick={() => {
                          if (activeSavedSearchId === savedSearch.id) {
                            clearActiveSavedDomainSearch();
                            return;
                          }

                          void loadSavedDomainSearch(savedSearch);
                        }}
                        disabled={savedSearchPendingId === savedSearch.id}
                        aria-pressed={activeSavedSearchId === savedSearch.id}
                      >
                        <span className={styles.savedSearchCardTopRow}>
                          <span className={styles.savedSearchDomain}>{savedSearch.domain}</span>
                          <span className={styles.savedSearchCardIcon} aria-hidden="true">
                            {savedSearchPendingId === savedSearch.id ? (
                              <LoaderCircle className={styles.spinner} aria-hidden="true" />
                            ) : (
                              <Globe aria-hidden="true" />
                            )}
                          </span>
                        </span>
                        <span className={styles.savedSearchMetaRow}>
                          <span className={styles.savedSearchMeta}>
                            {savedSearch.resultCount} result{savedSearch.resultCount === 1 ? "" : "s"}
                          </span>
                          <span className={styles.savedSearchUpdated}>
                            {formatSavedDomainSearchUpdatedAt(savedSearch.updatedAt)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </article>

            <article className={styles.resultsPanel}>
              <div className={styles.panelHeader}>
                <div className={styles.resultsPanelHeader}>
                  <div>
                    <h2>Results</h2>
                  </div>

                  {activeTab === "domain" ? (
                    <div className={styles.resultsHeaderActions}>
                      <span className={styles.resultsSelectionCount}>
                        <span>Selected</span>
                        <strong>{selectedCount}</strong>
                      </span>
                      <button
                        type="button"
                        className={styles.resultsExportButton}
                        onClick={handleExportSelectedContacts}
                        disabled={selectedCount === 0}
                      >
                        <span className={styles.resultsExportButtonIcon} aria-hidden="true">
                          <Download aria-hidden="true" />
                        </span>
                        <span>Export to CSV</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {pending ? (
                <div className={styles.feedbackEmpty}>
                  <LoaderCircle className={styles.spinner} aria-hidden="true" />
                  <span>Searching Hunter…</span>
                </div>
              ) : null}

              {!pending && !hasSearched ? (
                <div className={styles.feedbackEmpty}>
                  <Search aria-hidden="true" />
                  <span>Run a search to see clean Hunter results here.</span>
                </div>
              ) : null}

              {!pending && hasSearched && results.length === 0 ? (
                <div className={styles.feedbackEmpty}>
                  <AlertCircle aria-hidden="true" />
                  <span>No results found for that query.</span>
                </div>
              ) : null}

              {!pending && results.length > 0 ? (
                <section className={styles.resultsShell} aria-label="Hunter results">
                  <div className={styles.resultsSummary}>
                    <div>
                      <p className={styles.resultsEyebrow}>Returned matches</p>
                      <strong>{results.length} result{results.length === 1 ? "" : "s"}</strong>
                    </div>
                  </div>

                  <div className={styles.resultsViewport}>
                    {activeTab === "domain" ? (
                      groupedDomainResults.length ? (
                        <div className={styles.domainGroups}>
                          <div className={styles.domainCategoryRail} role="tablist" aria-label="Hunter result categories">
                            {groupedDomainResults.map((group) => (
                              <button
                                key={group.category}
                                type="button"
                                role="tab"
                                aria-selected={activeDomainGroup?.category === group.category}
                                className={`${styles.domainCategoryPill} ${
                                  activeDomainGroup?.category === group.category ? styles.domainCategoryPillActive : ""
                                }`}
                                onClick={() => setSelectedDomainCategory(group.category)}
                              >
                                <span>{group.category}</span>
                                <strong>{group.rows.length}</strong>
                              </button>
                            ))}
                          </div>

                          {activeDomainGroup ? (
                            <section className={styles.domainGroup}>
                              <div className={styles.domainGroupHeader}>
                                <div className={styles.domainGroupMeta}>
                                  <strong>{activeDomainGroup.category}</strong>
                                  <span>
                                    {activeDomainGroup.rows.length} result{activeDomainGroup.rows.length === 1 ? "" : "s"}
                                  </span>
                                </div>

                                {activeDomainGroup.totalPages > 1 ? (
                                  <div className={styles.resultsPager} aria-label={`${activeDomainGroup.category} pagination`}>
                                    <button
                                      type="button"
                                      className={styles.resultsPagerButton}
                                      onClick={() =>
                                        setDomainPages((current) => ({
                                          ...current,
                                          [activeDomainGroup.category]: Math.max(1, activeDomainGroup.currentPage - 1)
                                        }))
                                      }
                                      disabled={activeDomainGroup.currentPage === 1}
                                      aria-label={`Previous ${activeDomainGroup.category} page`}
                                    >
                                      <ChevronLeft aria-hidden="true" />
                                    </button>
                                    <span className={styles.resultsPagerCount}>
                                      {activeDomainGroup.currentPage} / {activeDomainGroup.totalPages}
                                    </span>
                                    <button
                                      type="button"
                                      className={styles.resultsPagerButton}
                                      onClick={() =>
                                        setDomainPages((current) => ({
                                          ...current,
                                          [activeDomainGroup.category]: Math.min(
                                            activeDomainGroup.totalPages,
                                            activeDomainGroup.currentPage + 1
                                          )
                                        }))
                                      }
                                      disabled={activeDomainGroup.currentPage === activeDomainGroup.totalPages}
                                      aria-label={`Next ${activeDomainGroup.category} page`}
                                    >
                                      <ChevronRight aria-hidden="true" />
                                    </button>
                                  </div>
                                ) : null}
                              </div>

                              <div className={styles.resultsList}>
                                {activeDomainGroup.visibleRows.map((row) => (
                                  <article key={`${activeDomainGroup.category}-${row.email}-${row.source}`} className={styles.resultCard}>
                                    <div className={styles.resultHeader}>
                                      <div className={styles.resultSelection}>
                                        <label className={styles.resultCheckboxLabel}>
                                          <input
                                            type="checkbox"
                                            className={styles.resultCheckboxInput}
                                            checked={selectedContactKeys.has(row.selectionKey)}
                                            onChange={() => toggleContactSelection(row.selectionKey)}
                                            aria-label={`Select ${row.name || row.email}`}
                                          />
                                          <span className={styles.resultCheckboxControl} aria-hidden="true">
                                            <Check aria-hidden="true" />
                                          </span>
                                        </label>

                                        <div className={styles.resultPrimary}>
                                          <span className={styles.resultLabel}>Contact</span>
                                          <strong className={styles.resultName}>{row.name || "Unknown contact"}</strong>
                                          <strong className={styles.resultEmail}>{row.email}</strong>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        className={styles.copyButtonSecondary}
                                        onClick={() => handleCopy(row.email)}
                                        aria-label={`Copy ${row.email}`}
                                      >
                                        {copiedEmail === row.email ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                        {copiedEmail === row.email ? "Copied" : "Copy email"}
                                      </button>
                                    </div>

                                    <dl className={styles.resultMeta}>
                                      <div className={styles.resultMetaCard}>
                                        <dt>Name</dt>
                                        <dd>{row.name || "Unknown contact"}</dd>
                                      </div>
                                      <div className={styles.resultMetaCard}>
                                        <dt>Email</dt>
                                        <dd>{row.email}</dd>
                                      </div>
                                      <div className={styles.resultMetaCard}>
                                        <dt>Position</dt>
                                        <dd>{row.position ?? "—"}</dd>
                                      </div>
                                      <div className={styles.resultMetaCard}>
                                        <dt>Confidence</dt>
                                        <dd>{typeof row.confidence === "number" ? `${row.confidence}%` : "—"}</dd>
                                      </div>
                                      <div className={`${styles.resultMetaCard} ${styles.resultMetaWide}`}>
                                        <dt>Source domain</dt>
                                        <dd>{row.source}</dd>
                                      </div>
                                    </dl>
                                  </article>
                                ))}
                              </div>
                            </section>
                          ) : null}
                        </div>
                      ) : null
                    ) : (
                      <div className={styles.resultsList}>
                        {results.map((row) => (
                          <article key={`${row.email}-${row.source}`} className={styles.resultCard}>
                            <div className={styles.resultHeader}>
                              <div className={styles.resultPrimary}>
                                <span className={styles.resultLabel}>Contact</span>
                                <strong className={styles.resultName}>{row.name || "Unknown contact"}</strong>
                                <strong className={styles.resultEmail}>{row.email}</strong>
                              </div>

                              <button
                                type="button"
                                className={styles.copyButtonSecondary}
                                onClick={() => handleCopy(row.email)}
                                aria-label={`Copy ${row.email}`}
                              >
                                {copiedEmail === row.email ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                {copiedEmail === row.email ? "Copied" : "Copy email"}
                              </button>
                            </div>

                            <dl className={styles.resultMeta}>
                              <div className={styles.resultMetaCard}>
                                <dt>Name</dt>
                                <dd>{row.name || "Unknown contact"}</dd>
                              </div>
                              <div className={styles.resultMetaCard}>
                                <dt>Email</dt>
                                <dd>{row.email}</dd>
                              </div>
                              <div className={styles.resultMetaCard}>
                                <dt>Position</dt>
                                <dd>{row.position ?? "—"}</dd>
                              </div>
                              <div className={styles.resultMetaCard}>
                                <dt>Confidence</dt>
                                <dd>{typeof row.confidence === "number" ? `${row.confidence}%` : "—"}</dd>
                              </div>
                              <div className={`${styles.resultMetaCard} ${styles.resultMetaWide}`}>
                                <dt>Source domain</dt>
                                <dd>{row.source}</dd>
                              </div>
                            </dl>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </article>
          </div>
        </section>
      </div>

      {isSettingsOpen ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => !settingsPending && setIsSettingsOpen(false)}>
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hunter-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Secure settings</p>
                <h2 id="hunter-settings-title">Hunter API key</h2>
                <p className={styles.modalDescription}>
                  Save your own Hunter key once. It is encrypted on the server and only attached inside backend requests.
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => !settingsPending && setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <div className={`${styles.modalBody} form`}>
              <div className="field">
                <label htmlFor="hunter-api-key">API key</label>
                <input
                  id="hunter-api-key"
                  type="password"
                  placeholder="Paste your Hunter API key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                />
                <p className={styles.modalKeyStatusNote}>
                  {keyStatus.configured
                    ? `Saved key ••••${keyStatus.last4 ?? "----"}${keyStatus.updatedAt ? ` · ${formatUpdatedAt(keyStatus.updatedAt)}` : ""}`
                    : "No Hunter key saved yet for this account."}
                </p>
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.modalSecondaryButton}
                  onClick={() => setIsSettingsOpen(false)}
                  disabled={settingsPending}
                >
                  Cancel
                </button>
                <button type="button" className={styles.modalPrimaryButton} onClick={handleSaveApiKey} disabled={settingsPending}>
                  <span className={styles.modalButtonIcon}>
                    {settingsPending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  </span>
                  Save key
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
