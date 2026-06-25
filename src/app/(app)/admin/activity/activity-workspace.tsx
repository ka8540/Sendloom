"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  ChevronDown,
  CircleAlert,
  Clock,
  Columns3,
  FileSpreadsheet,
  KeyRound,
  ListFilter,
  MailPlus,
  Paperclip,
  RefreshCw,
  Reply,
  ScrollText,
  Search,
  SendHorizontal,
  Server,
  ShieldAlert,
  ShieldUser,
  TriangleAlert,
  UserRound,
  UserSearch,
  Zap,
} from "lucide-react";

import { formatRelativeTime } from "@/components/dashboard/formatters";
import { LocalDateTime } from "@/components/local-date-time";

import styles from "./activity.module.css";

// ── Types (mirror the admin-activity service serializers) ────────────────────

export type ActivityUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  isRestricted: boolean;
  isLoggedIn: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  senderCount: number;
};

type ActivitySummary = {
  id: string;
  email: string;
  isAdmin: boolean;
  isRestricted: boolean;
  isLoggedIn: boolean;
  authProvider: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  counts: {
    imports: number;
    mappings: number;
    templates: number;
    campaigns: number;
    senderProfiles: number;
    suppressions: number;
  };
  totalSends: number;
  failedSends: number;
  eventCount: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
};

type ActivityEvent = {
  id: string;
  action: string;
  category: string;
  severity: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type DateRange = "today" | "7d" | "30d" | "all";

// ── Display config ────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  AUTH: { label: "Auth", icon: KeyRound, tone: styles.toneAuth },
  USER: { label: "Account", icon: UserRound, tone: styles.toneAuth },
  IMPORT: { label: "Import", icon: FileSpreadsheet, tone: styles.toneData },
  MAPPING: { label: "Mapping", icon: Columns3, tone: styles.toneData },
  TEMPLATE: { label: "Template", icon: ScrollText, tone: styles.toneContent },
  SEQUENCE: { label: "Sequence", icon: SendHorizontal, tone: styles.toneSend },
  SENDER: { label: "Sender", icon: MailPlus, tone: styles.toneSend },
  EMAIL_SEND: { label: "Sending", icon: Zap, tone: styles.toneSend },
  FOLLOW_UP: { label: "Follow-up", icon: Reply, tone: styles.toneSend },
  FILE: { label: "File", icon: Paperclip, tone: styles.toneData },
  HUNTER: { label: "Hunter", icon: Search, tone: styles.toneContent },
  ADMIN: { label: "Admin", icon: ShieldUser, tone: styles.toneAdmin },
  SECURITY: { label: "Security", icon: ShieldAlert, tone: styles.toneSecurity },
  SYSTEM: { label: "System", icon: Server, tone: styles.toneData },
};

const SEVERITY_CONFIG: Record<string, { label: string; className: string } | undefined> = {
  SUCCESS: { label: "Success", className: styles.sevSuccess },
  WARNING: { label: "Warning", className: styles.sevWarning },
  ERROR: { label: "Error", className: styles.sevError },
  SECURITY: { label: "Security", className: styles.sevSecurity },
};

const ACTION_TITLES: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in failed",
  "auth.logout": "Signed out",
  "auth.signup": "Account created",
  "auth.google_login": "Signed in with Google",
  "auth.google_signup": "Signed up with Google",
  "sender.connected": "Gmail sender connected",
  "sender.connect_failed": "Gmail connection failed",
  "import.uploaded": "Import uploaded",
  "import.renamed": "Import renamed",
  "import.deleted": "Import deleted",
  "mapping.saved": "Mapping saved",
  "template.created": "Template created",
  "template.updated": "Template updated",
  "template.ai_enhanced": "AI enhancement used",
  "template.spam_fix_applied": "Spam fix applied",
  "sequence.created": "Sequence created",
  "sequence.updated": "Sequence updated",
  "sequence.deleted": "Sequence deleted",
  "sequence.launched": "Sequence launched",
  "sequence.scheduled": "Sequence scheduled",
  "sequence.paused": "Sequence paused",
  "sequence.resumed": "Sequence resumed",
  "sequence.schedule_updated": "Schedule updated",
  "sequence.validation_refreshed": "Validation refreshed",
  "sequence.retry_failed_started": "Retry of failed recipients",
  "send.run_completed": "Send run completed",
  "send.daily_limit_reached": "Daily safety limit reached",
  "file.attachments_uploaded": "Attachments uploaded",
  "hunter.email_search": "Hunter email search",
  "hunter.domain_search": "Hunter domain search",
  "hunter.api_key_saved": "Hunter API key saved",
  "admin.viewed_user_activity": "Admin viewed activity",
  "admin.user.update_controls": "Admin updated restrictions",
  "admin.user.update_and_revoke_session": "Admin restricted + ended sessions",
  "admin.user.delete_all_data": "Admin wiped account data",
  "security.admin_access_denied": "Admin access denied",
  // Legacy actions recorded before this console existed.
  "campaign.launch": "Sequence launched",
  "campaign.update": "Sequence updated",
  "campaign.delete": "Sequence deleted",
  "campaign.schedule.update": "Schedule updated",
  "campaign.retry_failed": "Retry of failed recipients",
};

const TARGET_TYPE_OPTIONS = [
  { value: "sequence", label: "Sequences" },
  { value: "campaign", label: "Sequences (legacy)" },
  { value: "import", label: "Imports" },
  { value: "mapping", label: "Mappings" },
  { value: "template", label: "Templates" },
  { value: "sender", label: "Senders" },
  { value: "run", label: "Send runs" },
  { value: "user", label: "Users" },
  { value: "domain_search", label: "Domain searches" },
];

const DATE_RANGES: Array<{ value: DateRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
];

function formatActionTitle(action: string) {
  const known = ACTION_TITLES[action];
  if (known) {
    return known;
  }

  const tail = action.split(".").pop() ?? action;
  const words = tail.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

function dayKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  if (dayKey(iso) === dayKey(today.toISOString())) {
    return "Today";
  }
  if (dayKey(iso) === dayKey(yesterday.toISOString())) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

function userInitials(email: string) {
  const handle = email.split("@")[0] ?? "";
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? handle[0] ?? "?";
  const second = parts[1]?.[0] ?? handle[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The request failed. Try again.");
  }
  return (await response.json()) as T;
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export function AdminActivityWorkspace({
  initialUsers,
  initialUserId,
}: {
  initialUsers: ActivityUser[];
  initialUserId: string | null;
}) {
  // User search
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ActivityUser[]>(initialUsers);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Selection + summary
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialUserId);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Timeline
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsPending, setEventsPending] = useState(false);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [targetType, setTargetType] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  const [debouncedEventQuery, setDebouncedEventQuery] = useState("");

  const searchAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const filtersReadyRef = useRef(false);

  const hasActiveFilters =
    dateRange !== "all" || Boolean(category) || Boolean(severity) || Boolean(targetType) || Boolean(debouncedEventQuery);

  // Debounced user search.
  useEffect(() => {
    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearchPending(true);
      setSearchError(null);

      try {
        const data = await fetchJson<{ users: ActivityUser[] }>(
          `/api/admin/users/search?q=${encodeURIComponent(query.trim())}`,
          controller.signal
        );
        setUsers(data.users);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchError(error instanceof Error ? error.message : "Search failed.");
        }
      } finally {
        if (searchAbortRef.current === controller) {
          setSearchPending(false);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Debounce search-within-events.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEventQuery(eventQuery.trim()), 350);
    return () => clearTimeout(timer);
  }, [eventQuery]);

  const buildActivityUrl = useCallback(
    (userId: string, cursor?: string | null) => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (category) params.set("category", category);
      if (severity) params.set("severity", severity);
      if (targetType) params.set("type", targetType);
      if (debouncedEventQuery) params.set("q", debouncedEventQuery);
      const from = rangeStart(dateRange);
      if (from) params.set("from", from.toISOString());
      const qs = params.toString();
      return `/api/admin/users/${userId}/activity${qs ? `?${qs}` : ""}`;
    },
    [category, severity, targetType, debouncedEventQuery, dateRange]
  );

  const loadUserDetail = useCallback(
    async (userId: string, options?: { skipSummary?: boolean }) => {
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;

      setEventsPending(true);
      setEventsError(null);
      setExpandedEventId(null);
      if (!options?.skipSummary) {
        setSummaryPending(true);
        setSummaryError(null);
      }

      const summaryPromise = options?.skipSummary
        ? null
        : fetchJson<ActivitySummary>(`/api/admin/users/${userId}/summary`, controller.signal)
            .then((data) => setSummary(data))
            .catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === "AbortError")) {
                setSummary(null);
                setSummaryError(error instanceof Error ? error.message : "Could not load the user summary.");
              }
            })
            .finally(() => {
              if (detailAbortRef.current === controller) {
                setSummaryPending(false);
              }
            });

      const eventsPromise = fetchJson<{ events: ActivityEvent[]; nextCursor: string | null }>(
        buildActivityUrl(userId),
        controller.signal
      )
        .then((data) => {
          setEvents(data.events);
          setNextCursor(data.nextCursor);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setEvents([]);
            setNextCursor(null);
            setEventsError(error instanceof Error ? error.message : "Could not load the activity timeline.");
          }
        })
        .finally(() => {
          if (detailAbortRef.current === controller) {
            setEventsPending(false);
          }
        });

      await Promise.all([summaryPromise, eventsPromise]);
    },
    [buildActivityUrl]
  );

  // Load detail on selection.
  useEffect(() => {
    if (!selectedUserId) {
      return;
    }

    setSummary(null);
    setEvents([]);
    setNextCursor(null);
    void loadUserDetail(selectedUserId);

    // Keep the URL shareable without triggering a server navigation.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("userId", selectedUserId);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // Non-essential — ignore environments without history access.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  // Refetch the timeline when filters change (summary stays put). Skipped on
  // mount — the selection effect above already fetches with current filters.
  useEffect(() => {
    if (!filtersReadyRef.current) {
      filtersReadyRef.current = true;
      return;
    }
    if (!selectedUserId) {
      return;
    }
    void loadUserDetail(selectedUserId, { skipSummary: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, severity, targetType, debouncedEventQuery, dateRange]);

  const handleLoadMore = useCallback(async () => {
    if (!selectedUserId || !nextCursor) {
      return;
    }

    setLoadMorePending(true);
    try {
      const data = await fetchJson<{ events: ActivityEvent[]; nextCursor: string | null }>(
        buildActivityUrl(selectedUserId, nextCursor)
      );
      setEvents((current) => [...current, ...data.events]);
      setNextCursor(data.nextCursor);
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : "Could not load more events.");
    } finally {
      setLoadMorePending(false);
    }
  }, [selectedUserId, nextCursor, buildActivityUrl]);

  const clearFilters = useCallback(() => {
    setDateRange("all");
    setCategory("");
    setSeverity("");
    setTargetType("");
    setEventQuery("");
    setDebouncedEventQuery("");
  }, []);

  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; events: ActivityEvent[] }> = [];
    for (const event of events) {
      const key = dayKey(event.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.events.push(event);
      } else {
        groups.push({ key, label: dayLabel(event.createdAt), events: [event] });
      }
    }
    return groups;
  }, [events]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedEmail = summary?.email ?? selectedUser?.email ?? null;

  return (
    <div className={styles.workspace} data-admin-tour="activity">
      {/* ── Left rail: search + selected user ── */}
      <aside className={styles.userRail}>
        <div className={`${styles.userSearchCard} card`}>
          <p className={styles.kicker}>Find a user</p>
          <label className={styles.searchField}>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Search by email or user ID"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users by email or ID"
            />
          </label>

          {searchError ? (
            <p className={styles.inlineError}>
              <CircleAlert aria-hidden="true" /> {searchError}
            </p>
          ) : null}

          <div className={styles.userList} data-pending={searchPending || undefined}>
            {users.length ? (
              users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`${styles.userItem}${user.id === selectedUserId ? ` ${styles.userItemSelected}` : ""}`}
                  onClick={() => setSelectedUserId(user.id)}
                  aria-pressed={user.id === selectedUserId}
                >
                  <span className={styles.userItemAvatar} aria-hidden="true">
                    {userInitials(user.email)}
                  </span>
                  <span className={styles.userItemBody}>
                    <span className={styles.userItemEmail} title={user.email}>
                      {user.email}
                    </span>
                    <span className={styles.userItemMeta}>
                      {user.lastSeenAt ? `Seen ${formatRelativeTime(user.lastSeenAt)}` : "Never seen"}
                      {" · "}
                      {user.senderCount} sender{user.senderCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className={styles.userItemPills}>
                    {user.isAdmin ? <span className={`${styles.pill} ${styles.pillWarning}`}>Admin</span> : null}
                    {user.isRestricted ? (
                      <span className={`${styles.pill} ${styles.pillWarning}`}>Restricted</span>
                    ) : null}
                    {user.isLoggedIn ? <span className={`${styles.pill} ${styles.pillActive}`}>Online</span> : null}
                  </span>
                </button>
              ))
            ) : (
              <p className={styles.userListEmpty}>{searchPending ? "Searching…" : "No users match that search."}</p>
            )}
          </div>
        </div>

        {selectedUserId ? (
          <div className={`${styles.selectedUserCard} card`}>
            {summaryPending && !summary ? (
              <div className={styles.selectedUserSkeleton} aria-hidden="true">
                <span className={styles.skeletonAvatar} />
                <span className={`${styles.skeletonLine} ${styles.skeletonLineWide}`} />
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLine} />
              </div>
            ) : summaryError ? (
              <div className={styles.panelError}>
                <CircleAlert aria-hidden="true" />
                <p>{summaryError}</p>
                <button type="button" onClick={() => void loadUserDetail(selectedUserId)}>
                  Retry
                </button>
              </div>
            ) : summary ? (
              <>
                <div className={styles.selectedUserHeader}>
                  <span className={styles.selectedUserAvatar} aria-hidden="true">
                    {userInitials(summary.email)}
                  </span>
                  <div className={styles.selectedUserIdentity}>
                    <p className={styles.kicker}>Selected user</p>
                    <h2 className={styles.selectedUserEmail} title={summary.email}>
                      {summary.email}
                    </h2>
                  </div>
                </div>

                <div className={styles.selectedUserPills}>
                  <span className={`${styles.pill} ${summary.isAdmin ? styles.pillWarning : ""}`}>
                    {summary.isAdmin ? "Admin" : "User"}
                  </span>
                  <span className={`${styles.pill} ${summary.isLoggedIn ? styles.pillActive : styles.pillMuted}`}>
                    {summary.isLoggedIn ? "Logged in" : "Offline"}
                  </span>
                  <span className={`${styles.pill} ${summary.isRestricted ? styles.pillWarning : styles.pillInfo}`}>
                    {summary.isRestricted ? "Restricted" : "Clear"}
                  </span>
                  <span className={styles.pill}>{summary.authProvider}</span>
                </div>

                <dl className={styles.selectedUserMeta}>
                  <div>
                    <dt>Created</dt>
                    <dd>
                      <LocalDateTime value={summary.createdAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Last login</dt>
                    <dd>
                      <LocalDateTime value={summary.lastLoginAt} emptyLabel="Never" />
                    </dd>
                  </div>
                  <div>
                    <dt>Last seen</dt>
                    <dd>
                      <LocalDateTime value={summary.lastSeenAt} emptyLabel="Not tracked" />
                    </dd>
                  </div>
                </dl>

                {!summary.isAdmin ? (
                  <Link
                    href={`/admin/restrictions?userId=${summary.id}` as Route}
                    className={styles.selectedUserLink}
                  >
                    Manage restrictions →
                  </Link>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* ── Right column: summary + timeline ── */}
      <section className={styles.detailColumn}>
        {!selectedUserId ? (
          <div className={`${styles.emptyState} card`}>
            <span className={styles.emptyStateIcon} aria-hidden="true">
              <UserSearch />
            </span>
            <h2>Search for a user to inspect their activity.</h2>
            <p className="muted">
              Pick an account from the left to see its footprint, timeline, and security-relevant events.
            </p>
          </div>
        ) : (
          <>
            {/* Summary tiles */}
            {summaryPending && !summary ? (
              <div className={styles.statGrid} aria-hidden="true">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className={`${styles.statTile} ${styles.statTileSkeleton} card`} />
                ))}
              </div>
            ) : summary ? (
              <div className={styles.statGrid}>
                {(
                  [
                    { label: "Imports", value: summary.counts.imports, icon: FileSpreadsheet },
                    { label: "Templates", value: summary.counts.templates, icon: ScrollText },
                    { label: "Sequences", value: summary.counts.campaigns, icon: SendHorizontal },
                    { label: "Senders", value: summary.counts.senderProfiles, icon: MailPlus },
                    { label: "Total sends", value: summary.totalSends, icon: Zap },
                    {
                      label: "Failed sends",
                      value: summary.failedSends,
                      icon: TriangleAlert,
                      alert: summary.failedSends > 0,
                    },
                    { label: "Suppressions", value: summary.counts.suppressions, icon: Ban },
                  ] as Array<{ label: string; value: number; icon: LucideIcon; alert?: boolean }>
                ).map(({ label, value, icon: Icon, alert }) => (
                  <article key={label} className={`${styles.statTile}${alert ? ` ${styles.statTileAlert}` : ""} card`}>
                    <span className={styles.statTileIcon} aria-hidden="true">
                      <Icon />
                    </span>
                    <p className={styles.statTileValue}>{value.toLocaleString("en-US")}</p>
                    <p className={styles.statTileLabel}>{label}</p>
                  </article>
                ))}
                <article className={`${styles.statTile} card`}>
                  <span className={styles.statTileIcon} aria-hidden="true">
                    <Clock />
                  </span>
                  <p className={`${styles.statTileValue} ${styles.statTileValueSmall}`}>
                    {summary.lastEventAt ? formatRelativeTime(summary.lastEventAt) : "—"}
                  </p>
                  <p className={styles.statTileLabel}>Last activity</p>
                </article>
              </div>
            ) : null}

            {/* Timeline */}
            <div className={`${styles.timelineCard} card`}>
              <div className={styles.timelineHeader}>
                <div>
                  <p className={styles.kicker}>Event timeline</p>
                  <h2 className={styles.timelineTitle}>
                    {selectedEmail ? `Everything ${selectedEmail} has done` : "Activity"}
                  </h2>
                  {summary?.firstEventAt ? (
                    <p className={styles.timelineRecordedSince}>
                      {summary.eventCount.toLocaleString("en-US")} event{summary.eventCount === 1 ? "" : "s"} ·
                      detailed activity recorded since <LocalDateTime value={summary.firstEventAt} />
                    </p>
                  ) : (
                    <p className={styles.timelineRecordedSince}>Detailed activity is recorded from now on.</p>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.refreshButton}
                  onClick={() => selectedUserId && void loadUserDetail(selectedUserId)}
                  disabled={eventsPending}
                  aria-label="Refresh timeline"
                >
                  <RefreshCw aria-hidden="true" className={eventsPending ? styles.refreshSpinning : undefined} />
                  Refresh
                </button>
              </div>

              {/* Filters */}
              <div className={styles.filterBar}>
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

                <select
                  className={styles.filterSelect}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-label="Filter by category"
                >
                  <option value="">All categories</option>
                  {Object.entries(CATEGORY_CONFIG).map(([value, config]) => (
                    <option key={value} value={value}>
                      {config.label}
                    </option>
                  ))}
                </select>

                <select
                  className={styles.filterSelect}
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                  aria-label="Filter by severity"
                >
                  <option value="">All severities</option>
                  <option value="INFO">Info</option>
                  <option value="SUCCESS">Success</option>
                  <option value="WARNING">Warning</option>
                  <option value="ERROR">Error</option>
                  <option value="SECURITY">Security</option>
                </select>

                <select
                  className={styles.filterSelect}
                  value={targetType}
                  onChange={(event) => setTargetType(event.target.value)}
                  aria-label="Filter by object type"
                >
                  <option value="">All objects</option>
                  {TARGET_TYPE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                <label className={styles.eventSearchField}>
                  <ListFilter aria-hidden="true" />
                  <input
                    type="search"
                    value={eventQuery}
                    placeholder="Search events"
                    onChange={(event) => setEventQuery(event.target.value)}
                    aria-label="Search within events"
                  />
                </label>
              </div>

              {/* Timeline body */}
              {eventsPending && !events.length ? (
                <div className={styles.timelineSkeleton} aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className={styles.skeletonRow}>
                      <span className={styles.skeletonNode} />
                      <span className={styles.skeletonRowBody}>
                        <span className={`${styles.skeletonLine} ${styles.skeletonLineWide}`} />
                        <span className={styles.skeletonLine} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : eventsError ? (
                <div className={styles.panelError}>
                  <CircleAlert aria-hidden="true" />
                  <p>{eventsError}</p>
                  <button
                    type="button"
                    onClick={() => selectedUserId && void loadUserDetail(selectedUserId, { skipSummary: true })}
                  >
                    Retry
                  </button>
                </div>
              ) : !events.length ? (
                <div className={styles.timelineEmpty}>
                  <span className={styles.emptyStateIcon} aria-hidden="true">
                    <Clock />
                  </span>
                  <h3>{hasActiveFilters ? "No events match these filters." : "No activity recorded yet."}</h3>
                  {hasActiveFilters ? (
                    <button type="button" className={styles.clearFiltersButton} onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : (
                    <p className="muted">
                      This account predates detailed logging — its current footprint is shown above, and new
                      actions will appear here as they happen.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.timeline}>
                    {dayGroups.map((group) => (
                      <section key={group.key} className={styles.dayGroup} aria-label={group.label}>
                        <header className={styles.dayHeader}>
                          <span className={styles.dayLabel}>{group.label}</span>
                          <span className={styles.dayRule} aria-hidden="true" />
                          <span className={styles.dayCount}>
                            {group.events.length} event{group.events.length === 1 ? "" : "s"}
                          </span>
                        </header>
                        <ol className={styles.eventList}>
                          {group.events.map((event) => (
                            <EventRow
                              key={event.id}
                              event={event}
                              expanded={expandedEventId === event.id}
                              onToggle={() =>
                                setExpandedEventId((current) => (current === event.id ? null : event.id))
                              }
                            />
                          ))}
                        </ol>
                      </section>
                    ))}
                  </div>

                  {nextCursor ? (
                    <div className={styles.loadMoreRow}>
                      <button
                        type="button"
                        className={styles.loadMoreButton}
                        onClick={() => void handleLoadMore()}
                        disabled={loadMorePending}
                      >
                        {loadMorePending ? "Loading…" : "Load more events"}
                      </button>
                    </div>
                  ) : (
                    <p className={styles.timelineEndNote}>End of recorded activity.</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: ActivityEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = CATEGORY_CONFIG[event.category] ?? CATEGORY_CONFIG.SYSTEM;
  const Icon = config.icon;
  const severity = SEVERITY_CONFIG[event.severity];
  const metadataEntries = event.metadata ? Object.entries(event.metadata) : [];
  const detailsId = `event-details-${event.id}`;

  const targetChip =
    event.targetName || event.targetType ? (
      event.targetType === "user" && event.targetId ? (
        <Link
          href={`/admin/restrictions?userId=${event.targetId}` as Route}
          className={`${styles.targetChip} ${styles.targetChipLink}`}
          title={`Open ${event.targetName ?? "user"} in Restrictions`}
        >
          {event.targetName ?? event.targetId}
        </Link>
      ) : (
        <span className={styles.targetChip} title={event.targetType ?? undefined}>
          {event.targetName ?? `${event.targetType} ${event.targetId?.slice(0, 8) ?? ""}`}
        </span>
      )
    ) : null;

  return (
    <li className={`${styles.eventRow}${expanded ? ` ${styles.eventRowExpanded}` : ""}`}>
      <span className={`${styles.eventNode} ${config.tone}`} aria-hidden="true">
        <Icon />
      </span>

      <div className={styles.eventBody}>
        <button
          type="button"
          className={styles.eventSummaryButton}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
        >
          <span className={styles.eventTitleRow}>
            <span className={styles.eventTitle}>{formatActionTitle(event.action)}</span>
            <span className={`${styles.pill} ${styles.pillCategory}`}>{config.label}</span>
            {severity ? <span className={`${styles.pill} ${severity.className}`}>{severity.label}</span> : null}
            <span className={styles.eventTime}>
              <span className={styles.eventRelative}>{formatRelativeTime(event.createdAt)}</span>
              <LocalDateTime value={event.createdAt} variant="time" className={styles.eventClock} />
            </span>
            <ChevronDown aria-hidden="true" className={styles.eventChevron} />
          </span>

          {event.message ? <span className={styles.eventMessage}>{event.message}</span> : null}
        </button>

        {targetChip ? <div className={styles.eventTargets}>{targetChip}</div> : null}

        <div id={detailsId} className={styles.eventDetails} hidden={!expanded}>
          <dl className={styles.eventDetailGrid}>
            <div>
              <dt>Action</dt>
              <dd className={styles.mono}>{event.action}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>
                <LocalDateTime value={event.createdAt} />
              </dd>
            </div>
            {event.targetType ? (
              <div>
                <dt>Object</dt>
                <dd className={styles.mono}>
                  {event.targetType}
                  {event.targetId ? ` · ${event.targetId}` : ""}
                </dd>
              </div>
            ) : null}
            {event.ipAddress ? (
              <div>
                <dt>IP address</dt>
                <dd className={styles.mono}>{event.ipAddress}</dd>
              </div>
            ) : null}
            {event.userAgent ? (
              <div className={styles.eventDetailWide}>
                <dt>User agent</dt>
                <dd className={styles.mono}>{event.userAgent}</dd>
              </div>
            ) : null}
            {metadataEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className={styles.mono}>
                  {typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </li>
  );
}
