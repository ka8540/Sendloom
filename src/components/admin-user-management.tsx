"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PanelRightOpen, Search } from "lucide-react";

import { AdminUserControls } from "@/components/admin-user-controls";
import { LocalDateTime } from "@/components/local-date-time";
import styles from "@/app/(app)/admin/page.module.css";

const PAGE_SIZE = 10;

type AdminDashboardUser = {
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

type AdminUserManagementProps = {
  users: AdminDashboardUser[];
  adminId: string;
};

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

function UserSearch({
  query,
  resultCount,
  totalCount,
  onChange
}: {
  query: string;
  resultCount: number;
  totalCount: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.userSearch}>
      <label className={styles.searchInputWrap}>
        <Search aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search users by email"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <span className={styles.searchResultCount}>
        {resultCount} of {totalCount} users
      </span>
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext
}: {
  page: number;
  pageCount: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className={styles.paginationControls}>
      <button type="button" onClick={onPrevious} disabled={!canGoPrevious} aria-label="Previous user page">
        <ChevronLeft aria-hidden="true" />
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button type="button" onClick={onNext} disabled={!canGoNext} aria-label="Next user page">
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

function UserTable({
  users,
  selectedUserId,
  onSelect
}: {
  users: AdminDashboardUser[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
}) {
  return (
    <div className={styles.userTableShell}>
      <table className={styles.userTable}>
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
          {users.length ? (
            users.map((user) => (
              <tr key={user.id} className={user.id === selectedUserId ? styles.selectedUserRow : undefined}>
                <td>
                  <button type="button" className={styles.userEmailButton} onClick={() => onSelect(user.id)}>
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
                  <span className={`${styles.statusPill} ${user.isAdmin ? styles.statusPillWarning : ""}`}>
                    {user.isAdmin ? "Admin" : "User"}
                  </span>
                </td>
                <td>
                  <span className={`${styles.statusPill} ${isRestricted(user) ? styles.statusPillWarning : styles.statusPillInfo}`}>
                    {isRestricted(user) ? "Restricted" : "Clear"}
                  </span>
                </td>
                <td>{user.counts.senderProfiles}</td>
                <td>
                  <LocalDateTime value={user.lastSeenAt} emptyLabel="Not tracked" />
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.rowActionButton}
                    onClick={() => onSelect(user.id)}
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
  );
}

function UserDetailPanel({ user, adminId }: { user: AdminDashboardUser | null; adminId: string }) {
  if (!user) {
    return (
      <aside className={`${styles.detailPanel} card`}>
        <p className={styles.emptyDetailText}>Select a user to inspect account details.</p>
      </aside>
    );
  }

  return (
    <aside className={`${styles.detailPanel} card`}>
      <div className={styles.detailPanelHeader}>
        <div>
          <p className={styles.sectionKicker}>Selected user</p>
          <h2>{user.email}</h2>
        </div>
        <div className={styles.userMeta}>
          <span className={`${styles.statusPill} ${user.isLoggedIn ? styles.statusPillActive : styles.statusPillMuted}`}>
            {getSessionLabel(user)}
          </span>
          <span className={`${styles.statusPill} ${user.isAdmin ? styles.statusPillWarning : ""}`}>
            {user.isAdmin ? "Admin" : "User"}
          </span>
          <span className={styles.statusPill}>{user.authProvider}</span>
        </div>
      </div>

      <div className={styles.detailsGrid}>
        <div className={styles.detailCard}>
          <span className={styles.detailLabel}>Created</span>
          <LocalDateTime value={user.createdAt} className={styles.detailValue} />
        </div>
        <div className={styles.detailCard}>
          <span className={styles.detailLabel}>Last login</span>
          <LocalDateTime value={user.lastLoginAt} className={styles.detailValue} emptyLabel="Never" />
        </div>
        <div className={styles.detailCard}>
          <span className={styles.detailLabel}>Last seen</span>
          <LocalDateTime value={user.lastSeenAt} className={styles.detailValue} emptyLabel="Not tracked yet" />
        </div>
        <div className={styles.detailCard}>
          <span className={styles.detailLabel}>Session expiry</span>
          <LocalDateTime value={user.sessionExpiresAt} className={styles.detailValue} emptyLabel="No active session" />
        </div>
      </div>

      <div className={styles.countGrid}>
        {[
          ["Imports", user.counts.imports],
          ["Mappings", user.counts.mappings],
          ["Templates", user.counts.templates],
          ["Campaigns", user.counts.campaigns],
          ["Senders", user.counts.senderProfiles],
          ["Suppressions", user.counts.suppressions]
        ].map(([label, value]) => (
          <div key={label} className={styles.countItem}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {user.isAdmin ? (
        <p className={styles.protectedAdminNotice}>Admin accounts are protected and cannot be restricted from this dashboard.</p>
      ) : (
        <AdminUserControls
          userId={user.id}
          email={user.email}
          isLoggedIn={user.isLoggedIn}
          isSelfProtected={user.id === adminId}
          isAdminProtected={user.isAdmin}
          initialControls={{
            apiAccessDisabled: user.apiAccessDisabled,
            importsWriteDisabled: user.importsWriteDisabled,
            templatesWriteDisabled: user.templatesWriteDisabled,
            launchesDisabled: user.launchesDisabled,
            aiEnhancementsDisabled: user.aiEnhancementsDisabled
          }}
        />
      )}

      {user.sessionStatus === "untracked" ? (
        <p className={styles.sessionNote}>
          This account has not created a tracked session on the admin-enabled deployment yet, so it may still be active elsewhere.
        </p>
      ) : null}
    </aside>
  );
}

export function AdminUserManagement({ users, adminId }: AdminUserManagementProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(users[0]?.id ?? null);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return users;
    }

    return users.filter((user) => user.email.toLowerCase().includes(normalizedQuery));
  }, [query, users]);

  const pageCount = Math.max(Math.ceil(filteredUsers.length / PAGE_SIZE), 1);
  const currentPageUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedUser = filteredUsers.find((user) => user.id === selectedUserId) ?? filteredUsers[0] ?? null;

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!filteredUsers.length) {
      setSelectedUserId(null);
      return;
    }

    if (!filteredUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUserId]);

  return (
    <section className={styles.managementSection} aria-labelledby="user-management-title">
      <div className={styles.managementHeader}>
        <div>
          <p className={styles.sectionKicker}>User management</p>
          <h2 id="user-management-title">Search, page, and inspect accounts</h2>
        </div>
        <PaginationControls
          page={page}
          pageCount={pageCount}
          canGoPrevious={page > 1}
          canGoNext={page < pageCount}
          onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
          onNext={() => setPage((current) => Math.min(current + 1, pageCount))}
        />
      </div>

      <div className={styles.managementGrid}>
        <div className={`${styles.userListCard} card`}>
          <UserSearch
            query={query}
            resultCount={filteredUsers.length}
            totalCount={users.length}
            onChange={setQuery}
          />
          <UserTable users={currentPageUsers} selectedUserId={selectedUser?.id ?? null} onSelect={setSelectedUserId} />
        </div>
        <UserDetailPanel user={selectedUser} adminId={adminId} />
      </div>
    </section>
  );
}
