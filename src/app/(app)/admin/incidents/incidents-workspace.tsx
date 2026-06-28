"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, RefreshCw, Search, ShieldAlert } from "lucide-react";

import { CircularCloseButton } from "@/components/circular-close-button";
import { formatRelativeTime } from "@/components/dashboard/formatters";
import { LocalDateTime } from "@/components/local-date-time";
import { APP_ERROR_CATEGORIES } from "@/lib/incident/app-error";
import { INCIDENT_SEVERITIES } from "@/lib/incident/severity";
import { INCIDENT_STATUSES } from "@/lib/incident/status";

import styles from "./incidents.module.css";

type IncidentListItem = {
  reportId: string;
  reporterPseudonym: string;
  feature: string;
  operation: string;
  category: string;
  severity: string;
  status: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  appVersion: string | null;
  createdAt: string;
};

type IncidentDetail = IncidentListItem & {
  internalCode: string | null;
  httpStatus: number | null;
  correlationId: string | null;
  route: string | null;
  requestMethod: string | null;
  browserFamily: string | null;
  platform: string | null;
  onlineStatus: boolean | null;
  retryable: boolean;
  serverStackFingerprint: string | null;
  diagnosticFingerprint: string | null;
  sanitizedContext: Record<string, unknown> | null;
  userNote: string | null;
  adminNotes: string | null;
  occurredAt: string | null;
};

type ListResponse = { items: IncidentListItem[]; nextCursor: string | null; totalCount: number };
type DateRange = "today" | "7d" | "30d" | "all";

const DATE_RANGES: Array<{ value: DateRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" }
];

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  INVESTIGATING: "Investigating",
  RESOLVED: "Resolved",
  IGNORED: "Ignored"
};

function rangeStart(range: DateRange): Date | null {
  const now = new Date();
  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The request failed. Please try again.");
  }
  return (await response.json()) as T;
}

function readCsrfToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const entry = document.cookie.split("; ").find((part) => part.startsWith("sendloom_csrf="));
  return entry ? decodeURIComponent(entry.slice("sendloom_csrf=".length)) : null;
}

export function AdminIncidentsWorkspace() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");

  const [items, setItems] = useState<IncidentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [pending, setPending] = useState(true);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const buildUrl = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (category) params.set("category", category);
      if (severity) params.set("severity", severity);
      if (status) params.set("status", status);
      const term = debouncedSearch.toUpperCase();
      if (term.startsWith("U-")) {
        params.set("reporter", debouncedSearch);
      } else if (term) {
        params.set("reportId", debouncedSearch);
      }
      const from = rangeStart(dateRange);
      if (from) params.set("from", from.toISOString());
      const qs = params.toString();
      return `/api/admin/incidents${qs ? `?${qs}` : ""}`;
    },
    [category, severity, status, debouncedSearch, dateRange]
  );

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setError(null);
    try {
      const data = await fetchJson<ListResponse>(buildUrl(), { signal: controller.signal });
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setTotalCount(data.totalCount);
    } catch (loadError) {
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
        setItems([]);
        setNextCursor(null);
        setError(loadError instanceof Error ? loadError.message : "Could not load incident reports.");
      }
    } finally {
      if (abortRef.current === controller) {
        setPending(false);
      }
    }
  }, [buildUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) {
      return;
    }
    setLoadMorePending(true);
    try {
      const data = await fetchJson<ListResponse>(buildUrl(nextCursor));
      setItems((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load more reports.");
    } finally {
      setLoadMorePending(false);
    }
  }, [nextCursor, buildUrl]);

  const applyUpdated = useCallback((detail: IncidentDetail) => {
    setItems((current) => current.map((item) => (item.reportId === detail.reportId ? { ...item, ...detail } : item)));
  }, []);

  const hasFilters = Boolean(category || severity || status || debouncedSearch || dateRange !== "all");

  return (
    <div className={styles.workspace}>
      <div className={`${styles.controls} card`}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder="Search by report ID (INC-…) or reporter code (U-…)"
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search incidents"
          />
        </label>

        <div className={styles.filters}>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by feature category">
            <option value="">All categories</option>
            {APP_ERROR_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter by severity">
            <option value="">All severities</option>
            {INCIDENT_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {INCIDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <div className={styles.segmented} role="group" aria-label="Date range">
            {DATE_RANGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={dateRange === value ? styles.segmentActive : undefined}
                onClick={() => setDateRange(value)}
                aria-pressed={dateRange === value}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={pending}
            aria-label="Refresh incidents"
          >
            <RefreshCw aria-hidden="true" className={pending ? styles.spin : undefined} />
            Refresh
          </button>
        </div>
      </div>

      <div className={`${styles.listCard} card`}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Reports</h2>
          {!pending && !error ? <span className="muted">{totalCount.toLocaleString("en-US")} total</span> : null}
        </div>

        {pending && !items.length ? (
          <div className={styles.skeletonList} aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeletonRow} />
            ))}
          </div>
        ) : error ? (
          <div className={styles.panelError}>
            <CircleAlert aria-hidden="true" />
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : !items.length ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <ShieldAlert />
            </span>
            <h3>No incident reports</h3>
            <p className="muted">
              {hasFilters
                ? "No reports match these filters."
                : "Reports submitted from Sendloom error screens will appear here."}
            </p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Reporter</th>
                    <th>Feature / operation</th>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Count</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.reportId} onClick={() => setSelectedId(item.reportId)} className={styles.row} tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelectedId(item.reportId);
                      }}
                    >
                      <td className={styles.mono}>{item.reportId}</td>
                      <td className={styles.mono}>{item.reporterPseudonym}</td>
                      <td>
                        <span className={styles.feature}>{item.feature}</span>
                        <span className={styles.operation}>{item.operation}</span>
                      </td>
                      <td>{titleCase(item.category)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[`sev${item.severity}`] ?? ""}`}>{titleCase(item.severity)}</span>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${styles[`status${item.status}`] ?? ""}`}>
                          {STATUS_LABELS[item.status] ?? item.status}
                        </span>
                      </td>
                      <td>{item.occurrenceCount}</td>
                      <td title={item.lastSeenAt}>{formatRelativeTime(item.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor ? (
              <div className={styles.loadMoreRow}>
                <button type="button" className={styles.loadMoreButton} onClick={() => void loadMore()} disabled={loadMorePending}>
                  {loadMorePending ? "Loading…" : "Load more reports"}
                </button>
              </div>
            ) : (
              <p className={styles.endNote}>End of incident reports.</p>
            )}
          </>
        )}
      </div>

      {selectedId ? (
        <IncidentDetailModal reportId={selectedId} onClose={() => setSelectedId(null)} onUpdated={applyUpdated} />
      ) : null}
    </div>
  );
}

function IncidentDetailModal({
  reportId,
  onClose,
  onUpdated
}: {
  reportId: string;
  onClose: () => void;
  onUpdated: (detail: IncidentDetail) => void;
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    setPending(true);
    setError(null);
    fetchJson<IncidentDetail>(`/api/admin/incidents/${encodeURIComponent(reportId)}`)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this incident.");
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const patch = useCallback(
    async (body: { status?: string; note?: string }) => {
      setWorking(true);
      setError(null);
      try {
        const csrf = readCsrfToken();
        const updated = await fetchJson<IncidentDetail>(`/api/admin/incidents/${encodeURIComponent(reportId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
          body: JSON.stringify(body)
        });
        setDetail(updated);
        onUpdated(updated);
        if (body.note) setNote("");
      } catch (patchError) {
        setError(patchError instanceof Error ? patchError.message : "The update could not be saved.");
      } finally {
        setWorking(false);
      }
    },
    [reportId, onUpdated]
  );

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !working) onClose();
    }}>
      <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label={`Incident ${reportId}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.modalHead}>
          <div>
            <p className={styles.kicker}>Incident</p>
            <h2 className={styles.modalTitle}>{reportId}</h2>
          </div>
          <CircularCloseButton label="Close incident" onClick={onClose} disabled={working} />
        </header>

        {pending ? (
          <p className="muted">Loading incident…</p>
        ) : error && !detail ? (
          <div className={styles.panelError}>
            <CircleAlert aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : detail ? (
          <div className={styles.modalBody}>
            <div className={styles.badgeRow}>
              <span className={`${styles.badge} ${styles[`sev${detail.severity}`] ?? ""}`}>{titleCase(detail.severity)}</span>
              <span className={`${styles.badge} ${styles[`status${detail.status}`] ?? ""}`}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
              <span className={styles.badge}>{detail.occurrenceCount}× occurrences</span>
            </div>

            <dl className={styles.detailGrid}>
              <Field label="Reporter (anonymous)" value={detail.reporterPseudonym} mono />
              <Field label="Feature" value={detail.feature} />
              <Field label="Operation" value={detail.operation} />
              <Field label="Category" value={titleCase(detail.category)} />
              <Field label="Internal code" value={detail.internalCode} mono />
              <Field label="HTTP status" value={detail.httpStatus != null ? String(detail.httpStatus) : null} />
              <Field label="Correlation ID" value={detail.correlationId} mono />
              <Field label="Route" value={detail.route} mono />
              <Field label="App version" value={detail.appVersion} />
              <Field label="Browser" value={detail.browserFamily} />
              <Field label="Platform" value={detail.platform} />
              <Field label="Online at failure" value={detail.onlineStatus == null ? null : detail.onlineStatus ? "Online" : "Offline"} />
              <Field label="Retryable" value={detail.retryable ? "Yes" : "No"} />
              <Field label="Stack fingerprint" value={detail.serverStackFingerprint} mono />
              <Field label="Diagnostic fingerprint" value={detail.diagnosticFingerprint} mono />
            </dl>

            <div className={styles.timeline}>
              <span>
                First seen: <LocalDateTime value={detail.firstSeenAt} />
              </span>
              <span>
                Last seen: <LocalDateTime value={detail.lastSeenAt} />
              </span>
              {detail.occurredAt ? (
                <span>
                  Occurred: <LocalDateTime value={detail.occurredAt} />
                </span>
              ) : null}
            </div>

            {detail.sanitizedContext && Object.keys(detail.sanitizedContext).length ? (
              <div className={styles.contextBlock}>
                <p className={styles.kicker}>Sanitized context</p>
                <dl className={styles.detailGrid}>
                  {Object.entries(detail.sanitizedContext).map(([key, value]) => (
                    <Field
                      key={key}
                      label={titleCase(key.replace(/([A-Z])/g, "_$1"))}
                      value={typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}
                      mono
                    />
                  ))}
                </dl>
              </div>
            ) : null}

            {detail.userNote ? (
              <div className={styles.contextBlock}>
                <p className={styles.kicker}>Reporter note (redacted)</p>
                <p className={styles.note}>{detail.userNote}</p>
              </div>
            ) : null}

            <div className={styles.workflow}>
              <p className={styles.kicker}>Status</p>
              <div className={styles.statusButtons}>
                {INCIDENT_STATUSES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.statusButton}${detail.status === value ? ` ${styles.statusButtonActive}` : ""}`}
                    onClick={() => void patch({ status: value })}
                    disabled={working || detail.status === value}
                  >
                    {STATUS_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>

            {detail.adminNotes ? (
              <div className={styles.contextBlock}>
                <p className={styles.kicker}>Internal admin notes</p>
                <pre className={styles.adminNotes}>{detail.adminNotes}</pre>
              </div>
            ) : null}

            <div className={styles.noteComposer}>
              <label className={styles.kicker} htmlFor="incident-admin-note">
                Add an internal note
              </label>
              <textarea
                id="incident-admin-note"
                className={styles.noteInput}
                value={note}
                maxLength={2000}
                rows={3}
                placeholder="Internal triage note (never shown to the reporter)…"
                onChange={(event) => setNote(event.target.value)}
                disabled={working}
              />
              <div className={styles.noteActions}>
                {error ? <span className={styles.inlineError}>{error}</span> : <span />}
                <button
                  type="button"
                  className="button"
                  onClick={() => void patch({ note: note.trim() })}
                  disabled={working || !note.trim()}
                >
                  {working ? "Saving…" : "Add note"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) {
    return null;
  }
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined}>{value}</dd>
    </div>
  );
}
