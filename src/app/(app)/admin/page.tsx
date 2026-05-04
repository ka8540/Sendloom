import type { CSSProperties } from "react";

import { AdminUserManagement } from "@/components/admin-user-management";
import { requireAdminUser } from "@/lib/auth";
import { listAdminUsers } from "@/services/admin";

import styles from "./page.module.css";

type FootprintMetric = {
  label: string;
  value: number;
};

function AdminStatsCharts({
  totalUsers,
  loggedInUsers,
  restrictedUsers,
  footprint
}: {
  totalUsers: number;
  loggedInUsers: number;
  restrictedUsers: number;
  footprint: FootprintMetric[];
}) {
  const offlineUsers = Math.max(totalUsers - loggedInUsers, 0);
  const statusTotal = Math.max(loggedInUsers + offlineUsers + restrictedUsers, 1);
  const loggedStop = (loggedInUsers / statusTotal) * 100;
  const offlineStop = ((loggedInUsers + offlineUsers) / statusTotal) * 100;
  const maxFootprint = Math.max(...footprint.map((item) => item.value), 1);

  const donutStyle = {
    "--logged-stop": `${loggedStop}%`,
    "--offline-stop": `${offlineStop}%`
  } as CSSProperties;

  return (
    <section className={styles.visualGrid} aria-label="Admin dashboard summary visuals">
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
                <span style={{ width: `${Math.max((item.value / maxFootprint) * 100, item.value > 0 ? 8 : 0)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

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
  const footprint: FootprintMetric[] = [
    { label: "Imports", value: users.reduce((sum, user) => sum + user.counts.imports, 0) },
    { label: "Mappings", value: users.reduce((sum, user) => sum + user.counts.mappings, 0) },
    { label: "Templates", value: users.reduce((sum, user) => sum + user.counts.templates, 0) },
    { label: "Campaigns", value: users.reduce((sum, user) => sum + user.counts.campaigns, 0) },
    { label: "Senders", value: metrics.connectedSenders },
    { label: "Suppressions", value: users.reduce((sum, user) => sum + user.counts.suppressions, 0) }
  ];

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 className={styles.heroTitle}>Admin dashboard</h1>
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

      <AdminStatsCharts
        totalUsers={metrics.totalUsers}
        loggedInUsers={metrics.loggedInUsers}
        restrictedUsers={metrics.restrictedUsers}
        footprint={footprint}
      />

      <AdminUserManagement users={users} adminId={admin.id} />
    </div>
  );
}
