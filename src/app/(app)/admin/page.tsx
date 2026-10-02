import type { Route } from "next";
import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import { getAdminOverview } from "@/services/admin-v2/overview";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminStatusBadge,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";

export default async function AdminOverviewPage() {
  await requireAdminUser();
  const data = await getAdminOverview();
  const healthChecks = [
    ["Database", data.health.checks.database],
    ["Redis", data.health.checks.redis],
    ["Storage", data.health.checks.storage],
    ["Google OAuth", data.health.checks.googleOAuth],
    ["Mail", data.health.checks.mailProvider],
    ["Cron", data.health.checks.cron],
  ] as const;
  return (
    <AdminShell>
      <AdminPageHeader
        title="Overview"
        description="Your command center for platform health, product use, and work that needs attention."
        actions={
          <>
            <Link className="button secondary" href="/admin/users">
              Find user
            </Link>
            <Link
              className="button secondary"
              href="/admin/communications/system-notices"
            >
              Send notice
            </Link>
            <Link
              className="button"
              href="/admin/communications/product-updates"
            >
              Announce update
            </Link>
          </>
        }
      />
      <AdminMetricStrip
        items={[
          { label: "Total users", value: data.metrics.totalUsers },
          { label: "Active users · 24h", value: data.metrics.activeUsers },
          {
            label: "Confirmed sends · 24h",
            value: data.metrics.confirmedSends,
          },
          {
            label: "Needs attention",
            value: data.metrics.needsAttention,
            tone: data.metrics.needsAttention ? "warning" : undefined,
          },
        ]}
      />
      <AdminSection
        title="Platform health"
        description={`Last checked ${new Date(data.health.timestamp).toLocaleString()}`}
        action={<Link href="/admin/operations">Open platform →</Link>}
      >
        <div
          className={styles.panel}
          style={{ display: "flex", flexWrap: "wrap", gap: ".65rem 1.25rem" }}
        >
          {healthChecks.map(([name, check]) => (
            <div
              key={name}
              style={{ display: "flex", alignItems: "center", gap: ".45rem" }}
            >
              <span>{name}</span>
              <AdminStatusBadge
                status={check.status}
                tone={
                  check.status === "ok" || check.status === "configured"
                    ? "healthy"
                    : check.status === "down"
                      ? "danger"
                      : "warning"
                }
              />
            </div>
          ))}
        </div>
      </AdminSection>
      <div className={styles.split}>
        <AdminSection
          title="Needs attention"
          description="Stored issues and current service checks"
          action={<Link href="/admin/operations">All operations →</Link>}
        >
          {data.attention.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.attention.map((item) => (
                <li key={item.id}>
                  <Link href={item.href as Route}>
                    <AdminStatusBadge
                      status={item.tone === "danger" ? "Critical" : "Attention"}
                      tone={item.tone}
                    />{" "}
                    <strong>{item.label}</strong>
                  </Link>
                  <div className={styles.muted}>{item.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <AdminEmptyState>
              No active issues in the current checks.
            </AdminEmptyState>
          )}
        </AdminSection>
        <AdminSection
          title="Running now"
          description="Current operational states"
        >
          <div className={styles.panel}>
            <ul className={styles.list}>
              {data.running.map((item) => (
                <li
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <span>{item.label}</span>
                  <strong>{item.value.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          </div>
        </AdminSection>
      </div>
      <div className={styles.split}>
        <AdminSection
          title="Product pulse"
          description="New users and confirmed sends by UTC day, last seven days"
          action={<Link href="/admin/analytics">Full analytics →</Link>}
        >
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>New users</th>
                  <th>Confirmed sends</th>
                </tr>
              </thead>
              <tbody>
                {data.pulse.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.users}</td>
                    <td>{day.sends}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSection>
        <AdminSection
          title="Recent admin activity"
          action={<Link href="/admin/audit">Audit & Security →</Link>}
        >
          {data.recentAdminEvents.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.recentAdminEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.message || event.action}</strong>
                  <div className={styles.muted}>
                    {new Date(event.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <AdminEmptyState>No admin events recorded yet.</AdminEmptyState>
          )}
        </AdminSection>
      </div>
    </AdminShell>
  );
}
