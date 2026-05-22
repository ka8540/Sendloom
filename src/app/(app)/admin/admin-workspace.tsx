"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  HardDrive,
  Key,
  LayoutDashboard,
  Mail,
  PanelRightOpen,
  Search,
  Server,
  Shield,
  Users,
  Zap,
} from "lucide-react";

import type { SystemHealthReport } from "@/lib/system-health";
import { AdminUserControls } from "@/components/admin-user-controls";
import { LocalDateTime } from "@/components/local-date-time";
import styles from "./page.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminDashboardUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  apiAccessDisabled: boolean;
  importsWriteDisabled: boolean;
  templatesWriteDisabled: boolean;
  launchesDisabled: boolean;
  aiEnhancementsDisabled: boolean;
  authProvider: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  sessionExpiresAt: string | null;
  isLoggedIn: boolean;
  sessionStatus: string;
  createdAt: string;
  counts: {
    imports: number;
    mappings: number;
    templates: number;
    campaigns: number;
    senderProfiles: number;
    suppressions: number;
  };
};

type AdminWorkspaceProps = {
  users: AdminDashboardUser[];
  systemHealth: SystemHealthReport;
  adminId: string;
  adminEmail: string;
  metrics: {
    totalUsers: number;
    loggedInUsers: number;
    restrictedUsers: number;
    connectedSenders: number;
  };
  footprint: Array<{ label: string; value: number }>;
};

type TabId = "overview" | "users" | "restrictions" | "health";

const PAGE_SIZE = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRestricted(user: AdminDashboardUser) {
  return (
    user.apiAccessDisabled ||
    user.importsWriteDisabled ||
    user.templatesWriteDisabled ||
    user.launchesDisabled ||
    user.aiEnhancementsDisabled
  );
}

function getSessionLabel(user: AdminDashboardUser) {
  return user.isLoggedIn ? "Logged in" : "Offline";
}

function isCheckHealthy(check: { status: string }) {
  return check.status === "ok" || check.status === "configured";
}

// ── Tab Navigation ────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview" as const, label: "Overview", Icon: LayoutDashboard },
  { id: "users" as const, label: "Users", Icon: Users },
  { id: "restrictions" as const, label: "Restrictions", Icon: Shield },
  { id: "health" as const, label: "System Health", Icon: Server },
];

function AdminTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <nav className={styles.adminTabBar} role="tablist" aria-label="Admin workspaces">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          aria-controls={`tabpanel-${id}`}
          id={`tab-${id}`}
          type="button"
          className={`${styles.adminTab}${activeTab === id ? ` ${styles.adminTabActive}` : ""}`}
          onClick={() => onTabChange(id)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  metrics,
  systemHealth,
  adminEmail,
  footprint,
  onNavigate,
}: {
  metrics: AdminWorkspaceProps["metrics"];
  systemHealth: SystemHealthReport;
  adminEmail: string;
  footprint: Array<{ label: string; value: number }>;
  onNavigate: (tab: TabId) => void;
}) {
  const { totalUsers, loggedInUsers, restrictedUsers } = metrics;
  const offlineUsers = Math.max(totalUsers - loggedInUsers, 0);
  const statusTotal = Math.max(loggedInUsers + offlineUsers + restrictedUsers, 1);
  const loggedStop = (loggedInUsers / statusTotal) * 100;
  const offlineStop = ((loggedInUsers + offlineUsers) / statusTotal) * 100;
  const donutStyle = {
    "--logged-stop": `${loggedStop}%`,
    "--offline-stop": `${offlineStop}%`,
  } as CSSProperties;
  const maxFootprint = Math.max(...footprint.map((item) => item.value), 1);

  const healthChecks = [
    { label: "Database", check: systemHealth.checks.database },
    { label: "Redis", check: systemHealth.checks.redis },
    { label: "Storage", check: systemHealth.checks.storage },
    { label: "OAuth", check: systemHealth.checks.googleOAuth },
    { label: "Mail", check: systemHealth.checks.mailProvider },
    { label: "Cron", check: systemHealth.checks.cron },
  ];

  const metricItems: Array<{ label: string; value: number }> = [
    { label: "Total users", value: metrics.totalUsers },
    { label: "Logged in now", value: metrics.loggedInUsers },
    { label: "Restricted accounts", value: metrics.restrictedUsers },
    { label: "Connected senders", value: metrics.connectedSenders },
  ];

  return (
    <div className={styles.tabPanel} role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">
      {/* Metric cards */}
      <section className={styles.metrics} aria-label="Key metrics">
        {metricItems.map(({ label, value }) => (
          <article key={label} className={`${styles.metricCard} card`}>
            <p className={styles.metricLabel}>{label}</p>
            <p className={styles.metricValue}>{value}</p>
          </article>
        ))}
      </section>

      {/* Admin badge + health strip */}
      <div className={styles.overviewStrip}>
        <div className={`${styles.adminBadgeCard} card`}>
          <p className={styles.sectionKicker}>Signed in as</p>
          <p className={styles.adminBadgeEmail}>{adminEmail}</p>
          <div className={styles.sessionChips}>
            <span className={`badge ${metrics.loggedInUsers ? "" : "warning"}`}>
              {metrics.loggedInUsers} active session{metrics.loggedInUsers === 1 ? "" : "s"}
            </span>
            <span className={`badge ${metrics.restrictedUsers ? "warning" : ""}`}>
              {metrics.restrictedUsers} restriction{metrics.restrictedUsers === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className={`${styles.healthStripCard} card`}>
          <div className={styles.healthStripHeader}>
            <div>
              <p className={styles.sectionKicker}>System health</p>
              <p className={styles.healthStripTitle}>Infrastructure status</p>
            </div>
            <span
              className={`${styles.statusPill} ${
                systemHealth.status === "ok" ? styles.statusPillActive : styles.statusPillWarning
              }`}
            >
              {systemHealth.status === "ok"
                ? "All healthy"
                : systemHealth.status === "degraded"
                ? "Degraded"
                : "Down"}
            </span>
          </div>
          <div className={styles.healthDots}>
            {healthChecks.map(({ label, check }) => (
              <div key={label} className={styles.healthDot}>
                <span
                  className={`${styles.healthDotIndicator} ${
                    isCheckHealthy(check) ? styles.healthDotOk : styles.healthDotWarn
                  }`}
                  aria-hidden="true"
                />
                <span className={styles.healthDotLabel}>{label}</span>
              </div>
            ))}
          </div>
          <button type="button" className={styles.healthViewLink} onClick={() => onNavigate("health")}>
            View full health report →
          </button>
        </div>
      </div>

      {/* Charts */}
      <section className={styles.visualGrid} aria-label="Account status and workspace footprint">
        <article className={`${styles.visualCard} card`}>
          <div className={styles.visualHeader}>
            <div>
              <p className={styles.sectionKicker}>Account status</p>
              <h2>User health mix</h2>
            </div>
            <span className={styles.visualTotal}>{totalUsers} total</span>
          </div>
          <div className={styles.donutLayout}>
            <div className={styles.donutRing} style={donutStyle} aria-hidden="true">
              <span>{totalUsers}</span>
            </div>
            <div className={styles.legendList}>
              <span>
                <i className={styles.legendActive} aria-hidden="true" />
                {loggedInUsers} logged in
              </span>
              <span>
                <i className={styles.legendOffline} aria-hidden="true" />
                {offlineUsers} offline
              </span>
              <span>
                <i className={styles.legendRestricted} aria-hidden="true" />
                {restrictedUsers} restricted
              </span>
            </div>
          </div>
        </article>

        <article className={`${styles.visualCard} card`}>
          <div className={styles.visualHeader}>
            <div>
              <p className={styles.sectionKicker}>User footprint</p>
              <h2>Workspace objects</h2>
            </div>
          </div>
          <div className={styles.barList}>
            {footprint.map((item) => (
              <div key={item.label} className={styles.barItem}>
                <div className={styles.barMeta}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className={styles.barTrack} aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.max((item.value / maxFootprint) * 100, item.value > 0 ? 8 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({
  users,
  selectedUserId,
  onSelectUser,
  adminId,
}: {
  users: AdminDashboardUser[];
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
  adminId: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.email.toLowerCase().includes(q)) : users;
  }, [query, users]);

  const pageCount = Math.max(Math.ceil(filteredUsers.length / PAGE_SIZE), 1);
  const currentPageUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedUser = filteredUsers.find((u) => u.id === selectedUserId) ?? filteredUsers[0] ?? null;
  const resultStart = filteredUsers.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const resultEnd = Math.min(page * PAGE_SIZE, filteredUsers.length);
  const rangeLabel =
    filteredUsers.length > PAGE_SIZE
      ? `Showing ${resultStart}–${resultEnd} of ${filteredUsers.length}`
      : `${filteredUsers.length} user${filteredUsers.length === 1 ? "" : "s"}`;

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!filteredUsers.length) {
      onSelectUser("");
      return;
    }
    if (!filteredUsers.some((u) => u.id === selectedUserId)) {
      onSelectUser(filteredUsers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredUsers]);

  const countItems: Array<[string, number]> = selectedUser
    ? [
        ["Imports", selectedUser.counts.imports],
        ["Mappings", selectedUser.counts.mappings],
        ["Templates", selectedUser.counts.templates],
        ["Campaigns", selectedUser.counts.campaigns],
        ["Senders", selectedUser.counts.senderProfiles],
        ["Suppressions", selectedUser.counts.suppressions],
      ]
    : [];

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="tabpanel-users"
      aria-labelledby="tab-users"
    >
      <div className={styles.managementSection}>
        <div className={styles.managementGrid}>
          {/* Table card */}
          <div className={`${styles.userListCard} card`}>
            <div className={styles.tableToolbar}>
              <div className={styles.userSearch}>
                <label className={styles.searchInputWrap}>
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    placeholder="Search users by email"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span className={styles.searchResultCount}>{rangeLabel}</span>
              </div>
              <div className={styles.paginationControls}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page === 1}
                  aria-label="Previous user page"
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <span>
                  {page} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
                  disabled={page >= pageCount}
                  aria-label="Next user page"
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className={styles.userTableShell}>
              <table className={styles.userTable}>
                <colgroup>
                  <col className={styles.emailColumn} />
                  <col className={styles.statusColumn} />
                  <col className={styles.roleColumn} />
                  <col className={styles.restrictedColumn} />
                  <col className={styles.sendersColumn} />
                  <col className={styles.lastSeenColumn} />
                  <col className={styles.actionColumn} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Role</th>
                    <th>Restricted</th>
                    <th>Senders</th>
                    <th>Last seen</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {currentPageUsers.length ? (
                    currentPageUsers.map((user) => (
                      <tr
                        key={user.id}
                        className={user.id === selectedUser?.id ? styles.selectedUserRow : undefined}
                      >
                        <td className={styles.emailCell}>
                          <button
                            type="button"
                            className={styles.userEmailButton}
                            onClick={() => onSelectUser(user.id)}
                            title={user.email}
                          >
                            {user.email}
                          </button>
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              user.isLoggedIn ? styles.statusPillActive : styles.statusPillMuted
                            }`}
                          >
                            {getSessionLabel(user)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${user.isAdmin ? styles.statusPillWarning : ""}`}
                          >
                            {user.isAdmin ? "Admin" : "User"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              isRestricted(user) ? styles.statusPillWarning : styles.statusPillInfo
                            }`}
                          >
                            {isRestricted(user) ? "Restricted" : "Clear"}
                          </span>
                        </td>
                        <td className={styles.numericCell}>{user.counts.senderProfiles}</td>
                        <td className={styles.lastSeenCell}>
                          <LocalDateTime
                            value={user.lastSeenAt}
                            emptyLabel="Not tracked"
                            className={styles.tableDate}
                          />
                        </td>
                        <td className={styles.actionCell}>
                          <button
                            type="button"
                            className={styles.rowActionButton}
                            onClick={() => onSelectUser(user.id)}
                            aria-label={`View ${user.email} details`}
                          >
                            <PanelRightOpen aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className={styles.emptyTableCell}>
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Inspector panel */}
          {!selectedUser ? (
            <aside className={`${styles.detailPanel} card`}>
              <p className={styles.emptyDetailText}>Select a user to inspect account details.</p>
            </aside>
          ) : (
            <aside className={`${styles.detailPanel} card`}>
              <div className={styles.detailPanelHeader}>
                <div>
                  <p className={styles.sectionKicker}>Selected user</p>
                  <h2 className={styles.detailEmail} title={selectedUser.email}>
                    {selectedUser.email}
                  </h2>
                </div>
                <div className={styles.userMeta}>
                  <span
                    className={`${styles.statusPill} ${
                      selectedUser.isLoggedIn ? styles.statusPillActive : styles.statusPillMuted
                    }`}
                  >
                    {getSessionLabel(selectedUser)}
                  </span>
                  <span
                    className={`${styles.statusPill} ${selectedUser.isAdmin ? styles.statusPillWarning : ""}`}
                  >
                    {selectedUser.isAdmin ? "Admin" : "User"}
                  </span>
                  <span className={styles.statusPill}>{selectedUser.authProvider}</span>
                </div>
              </div>

              <div className={styles.detailsGrid}>
                {(
                  [
                    { label: "Created", value: selectedUser.createdAt, emptyLabel: undefined },
                    { label: "Last login", value: selectedUser.lastLoginAt, emptyLabel: "Never" },
                    { label: "Last seen", value: selectedUser.lastSeenAt, emptyLabel: "Not tracked yet" },
                    {
                      label: "Session expiry",
                      value: selectedUser.sessionExpiresAt,
                      emptyLabel: "No active session",
                    },
                  ] as const
                ).map(({ label, value, emptyLabel }) => (
                  <div key={label} className={styles.detailCard}>
                    <span className={styles.detailLabel}>{label}</span>
                    <LocalDateTime value={value} className={styles.detailValue} emptyLabel={emptyLabel} />
                  </div>
                ))}
              </div>

              <div className={styles.countGrid}>
                {countItems.map(([label, value]) => (
                  <div key={label} className={styles.countItem}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              {selectedUser.isAdmin ? (
                <p className={styles.protectedAdminNotice}>
                  Admin accounts cannot be restricted from this panel.
                </p>
              ) : (
                <AdminUserControls
                  userId={selectedUser.id}
                  email={selectedUser.email}
                  isLoggedIn={selectedUser.isLoggedIn}
                  isSelfProtected={selectedUser.id === adminId}
                  isAdminProtected={selectedUser.isAdmin}
                  initialControls={{
                    apiAccessDisabled: selectedUser.apiAccessDisabled,
                    importsWriteDisabled: selectedUser.importsWriteDisabled,
                    templatesWriteDisabled: selectedUser.templatesWriteDisabled,
                    launchesDisabled: selectedUser.launchesDisabled,
                    aiEnhancementsDisabled: selectedUser.aiEnhancementsDisabled,
                  }}
                />
              )}

              {selectedUser.sessionStatus === "untracked" ? (
                <p className={styles.sessionNote}>
                  This account has not created a tracked session on the admin-enabled deployment yet,
                  so it may still be active elsewhere.
                </p>
              ) : null}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Restrictions Tab ──────────────────────────────────────────────────────────

function RestrictionsTab({
  users,
  selectedUserId,
  onSelectUser,
  adminId,
}: {
  users: AdminDashboardUser[];
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
  adminId: string;
}) {
  const [query, setQuery] = useState("");

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.email.toLowerCase().includes(q)) : users;
  }, [query, users]);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="tabpanel-restrictions"
      aria-labelledby="tab-restrictions"
    >
      <div className={styles.restrictionsLayout}>
        {/* User picker */}
        <div className={`${styles.restrictionsUserPickerCard} card`}>
          <div>
            <p className={styles.sectionKicker}>Account selection</p>
            <h2 className={styles.restrictionsPickerTitle}>Select an account</h2>
          </div>
          <label className={styles.searchInputWrap}>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Filter by email"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.restrictionsUserList}>
            {filteredUsers.length ? (
              filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  aria-pressed={user.id === selectedUserId}
                  className={`${styles.restrictionsUserItem}${
                    user.id === selectedUserId ? ` ${styles.restrictionsUserItemSelected}` : ""
                  }`}
                  onClick={() => onSelectUser(user.id)}
                >
                  <span className={styles.restrictionsUserItemEmail}>{user.email}</span>
                  <span className={styles.restrictionsUserItemPills}>
                    {user.isAdmin && (
                      <span className={`${styles.statusPill} ${styles.statusPillWarning}`}>Admin</span>
                    )}
                    {isRestricted(user) && (
                      <span className={`${styles.statusPill} ${styles.statusPillWarning}`}>
                        Restricted
                      </span>
                    )}
                  </span>
                </button>
              ))
            ) : (
              <p className={styles.restrictionsEmptyState}>No users match your filter.</p>
            )}
          </div>
        </div>

        {/* Restrictions panel */}
        <div className={`${styles.restrictionsPanelCard} card`}>
          {!selectedUser ? (
            <p className={styles.emptyDetailText}>
              Select an account from the list to manage restrictions.
            </p>
          ) : (
            <>
              <div className={styles.restrictionsPanelHeader}>
                <p className={styles.sectionKicker}>Managing restrictions for</p>
                <p className={styles.restrictionsPanelEmail} title={selectedUser.email}>
                  {selectedUser.email}
                </p>
                <div className={styles.restrictionsBadgeRow}>
                  <span
                    className={`${styles.statusPill} ${
                      selectedUser.isLoggedIn ? styles.statusPillActive : styles.statusPillMuted
                    }`}
                  >
                    {getSessionLabel(selectedUser)}
                  </span>
                  <span
                    className={`${styles.statusPill} ${selectedUser.isAdmin ? styles.statusPillWarning : ""}`}
                  >
                    {selectedUser.isAdmin ? "Admin" : "User"}
                  </span>
                  <span className={styles.statusPill}>{selectedUser.authProvider}</span>
                </div>
              </div>

              {selectedUser.isAdmin ? (
                <p className={styles.protectedAdminNotice}>
                  Admin accounts cannot be restricted from this panel.
                </p>
              ) : (
                <AdminUserControls
                  userId={selectedUser.id}
                  email={selectedUser.email}
                  isLoggedIn={selectedUser.isLoggedIn}
                  isSelfProtected={selectedUser.id === adminId}
                  isAdminProtected={selectedUser.isAdmin}
                  initialControls={{
                    apiAccessDisabled: selectedUser.apiAccessDisabled,
                    importsWriteDisabled: selectedUser.importsWriteDisabled,
                    templatesWriteDisabled: selectedUser.templatesWriteDisabled,
                    launchesDisabled: selectedUser.launchesDisabled,
                    aiEnhancementsDisabled: selectedUser.aiEnhancementsDisabled,
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── System Health Tab ─────────────────────────────────────────────────────────

function SystemHealthTab({ systemHealth }: { systemHealth: SystemHealthReport }) {
  const healthChecks = [
    { label: "Database", check: systemHealth.checks.database, Icon: Database },
    { label: "Redis", check: systemHealth.checks.redis, Icon: Server },
    { label: "Storage / R2", check: systemHealth.checks.storage, Icon: HardDrive },
    { label: "Google OAuth", check: systemHealth.checks.googleOAuth, Icon: Key },
    { label: "Mail Provider", check: systemHealth.checks.mailProvider, Icon: Mail },
    { label: "Cron", check: systemHealth.checks.cron, Icon: Zap },
  ];

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="tabpanel-health"
      aria-labelledby="tab-health"
    >
      <div className={styles.healthTabHeader}>
        <div>
          <p className={styles.sectionKicker}>Infrastructure</p>
          <h2>Runtime checks</h2>
        </div>
        <span
          className={`${styles.statusPill} ${
            systemHealth.status === "ok" ? styles.statusPillActive : styles.statusPillWarning
          }`}
        >
          {systemHealth.status === "ok"
            ? "Healthy"
            : systemHealth.status === "degraded"
            ? "Degraded"
            : "Down"}
        </span>
      </div>

      <div className={styles.healthGrid}>
        {healthChecks.map(({ label, check, Icon }) => {
          const ok = isCheckHealthy(check);
          return (
            <article
              key={label}
              className={`${styles.healthCheckCard} card${ok ? "" : ` ${styles.healthCheckWarn}`}`}
            >
              <div className={styles.healthCheckTop}>
                <div
                  className={`${styles.healthCheckIcon}${ok ? "" : ` ${styles.healthCheckIconWarn}`}`}
                >
                  <Icon aria-hidden="true" />
                </div>
                <span
                  className={`${styles.statusPill} ${
                    ok ? styles.statusPillActive : styles.statusPillWarning
                  }`}
                >
                  {ok ? "Healthy" : "Issue"}
                </span>
              </div>
              <p className={styles.healthCheckLabel}>{label}</p>
              <p className={styles.healthCheckMessage}>{check.message}</p>
            </article>
          );
        })}
      </div>

      <p className={styles.sessionNote}>
        Last checked <LocalDateTime value={systemHealth.timestamp} />.
      </p>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function AdminWorkspace({
  users,
  systemHealth,
  adminId,
  adminEmail,
  metrics,
  footprint,
}: AdminWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(users[0]?.id ?? null);

  const handleSelectUser = useCallback((id: string) => {
    setSelectedUserId(id || null);
  }, []);

  return (
    <div className={styles.adminWorkspace}>
      <AdminTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" && (
        <OverviewTab
          metrics={metrics}
          systemHealth={systemHealth}
          adminEmail={adminEmail}
          footprint={footprint}
          onNavigate={setActiveTab}
        />
      )}
      {activeTab === "users" && (
        <UsersTab
          users={users}
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
          adminId={adminId}
        />
      )}
      {activeTab === "restrictions" && (
        <RestrictionsTab
          users={users}
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
          adminId={adminId}
        />
      )}
      {activeTab === "health" && <SystemHealthTab systemHealth={systemHealth} />}
    </div>
  );
}
