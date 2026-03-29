import { LocalDateTime } from "@/components/local-date-time";
import { AdminUserControls } from "@/components/admin-user-controls";
import { requireAdminUser } from "@/lib/auth";
import { listAdminUsers } from "@/services/admin";

import styles from "./page.module.css";

export default async function AdminDashboardPage() {
  const admin = await requireAdminUser();
  const users = await listAdminUsers();

  const metrics = {
    totalUsers: users.length,
    loggedInUsers: users.filter((user) => user.isLoggedIn).length,
    restrictedUsers: users.filter(
      (user) =>
        user.apiAccessDisabled ||
        user.importsWriteDisabled ||
        user.templatesWriteDisabled ||
        user.launchesDisabled ||
        user.aiEnhancementsDisabled
    ).length,
    connectedSenders: users.reduce((sum, user) => sum + user.counts.senderProfiles, 0)
  };

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 style={{ margin: 0 }}>Admin dashboard</h1>
        <p className="muted">
          Review active accounts, inspect user-level footprint, restrict API capabilities, end sessions, and wipe an account’s data
          from one protected control surface.
        </p>
      </section>

      <section className={styles.metrics}>
        {[
          ["Users", metrics.totalUsers],
          ["Logged in now", metrics.loggedInUsers],
          ["Restricted accounts", metrics.restrictedUsers],
          ["Connected senders", metrics.connectedSenders]
        ].map(([label, value]) => (
          <article key={label} className={`${styles.metricCard} card`}>
            <p className={styles.metricLabel}>{label}</p>
            <p className={styles.metricValue}>{value}</p>
          </article>
        ))}
      </section>

      <section className={`${styles.summary} card`}>
        <span className={`badge ${metrics.loggedInUsers ? "" : "warning"}`}>{metrics.loggedInUsers} active user session{metrics.loggedInUsers === 1 ? "" : "s"}</span>
        <span className={`badge ${metrics.restrictedUsers ? "warning" : ""}`}>{metrics.restrictedUsers} account restriction{metrics.restrictedUsers === 1 ? "" : "s"}</span>
        <span className="badge">Signed in as {admin.email}</span>
      </section>

      <section className={styles.userGrid}>
        {users.map((user) => (
          <article key={user.id} className={`${styles.userCard} card`}>
            <div className={styles.userHeader}>
              <div className={styles.userIdentity}>
                <h2>{user.email}</h2>
                <div className={styles.userMeta}>
                  <span
                    className={`${styles.statusPill} ${
                      user.sessionStatus === "active"
                        ? styles.statusPillActive
                        : user.sessionStatus === "untracked"
                          ? styles.statusPillInfo
                          : styles.statusPillMuted
                    }`}
                  >
                    {user.sessionStatus === "active"
                      ? "Logged in"
                      : user.sessionStatus === "untracked"
                        ? "Session not tracked"
                        : "Signed out"}
                  </span>
                  {user.isAdmin ? <span className={`${styles.statusPill} ${styles.statusPillWarning}`}>Admin</span> : null}
                  {user.apiAccessDisabled ? <span className={`${styles.statusPill} ${styles.statusPillWarning}`}>API disabled</span> : null}
                  <span className={styles.statusPill}>{user.authProvider}</span>
                </div>
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

            <AdminUserControls
              userId={user.id}
              email={user.email}
              isLoggedIn={user.isLoggedIn}
              isSelfProtected={user.id === admin.id}
              isAdminProtected={user.isAdmin}
              initialControls={{
                apiAccessDisabled: user.apiAccessDisabled,
                importsWriteDisabled: user.importsWriteDisabled,
                templatesWriteDisabled: user.templatesWriteDisabled,
                launchesDisabled: user.launchesDisabled,
                aiEnhancementsDisabled: user.aiEnhancementsDisabled
              }}
            />

            {user.sessionStatus === "untracked" ? (
              <p className={styles.sessionNote}>
                This account has not created a tracked session on the admin-enabled deployment yet, so it may still be active elsewhere.
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
