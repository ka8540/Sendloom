import type { Route } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireAdminUser } from "@/lib/auth";
import { getAdminOverview } from "@/services/admin-v2/overview";
import { AdminTimeChart } from "@/components/admin-v2/admin-charts";
import {
  formatAdminInstant,
  formatAdminRelative,
} from "@/components/admin-v2/format";
import {
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
    ["Google", data.health.checks.googleOAuth],
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
          {
            label: "Total accounts",
            value: data.metrics.totalUsers,
            note: "Includes admins",
          },
          {
            label: "Product users active · 24h",
            value: data.metrics.activeUsers,
            note: "Latest activity",
          },
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
        description={`Checked ${formatAdminInstant(data.health.timestamp)}`}
        action={<Link href="/admin/operations">Open operations →</Link>}
      >
        <div className={`${styles.panel} ${styles.healthGrid}`}>
          {healthChecks.map(([name, check]) => (
            <div className={styles.healthCell} key={name}>
              <strong>{name}</strong>
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
      <div className={styles.twoColumn}>
        <AdminSection
          title="Needs attention"
          action={<Link href="/admin/operations">All operations →</Link>}
        >
          {data.attention.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.attention.slice(0, 6).map((item) => (
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
            <div className={styles.successRow}>
              <CheckCircle2 size={17} aria-hidden="true" />
              No issues need attention
            </div>
          )}
        </AdminSection>
        <AdminSection
          title="Running now"
          description="Current operational states"
        >
          <div className={styles.panel}>
            <dl className={styles.dataList}>
              {data.running.map((item) => (
                <div className={styles.definitionRow} key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </div>
        </AdminSection>
      </div>
      <AdminSection
        title="Product pulse"
        description="Confirmed sends, sequence launches, and Discover searches by UTC day"
        action={<Link href="/admin/analytics">Full analytics →</Link>}
      >
        <div className={styles.panel}>
          <AdminTimeChart
            data={data.pulse}
            series={[
              {
                key: "sends",
                name: "Confirmed sends",
                color: "var(--analysis-green)",
              },
              {
                key: "runs",
                name: "Sequence runs",
                color: "var(--analysis-blue)",
              },
              {
                key: "searches",
                name: "Discover searches",
                color: "var(--analysis-purple)",
              },
            ]}
          />
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Recent admin activity"
          action={<Link href="/admin/audit">Audit & Security →</Link>}
        >
          {data.recentAdminEvents.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.recentAdminEvents.map((event) => (
                <li key={event.id} className={styles.activityRow}>
                  <strong>{event.message || event.action}</strong>
                  <small title={formatAdminInstant(event.createdAt)}>
                    {formatAdminRelative(event.createdAt)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.compactEmpty}>No admin events recorded yet.</p>
          )}
        </AdminSection>
        <AdminSection
          title="Recently joined accounts"
          action={<Link href="/admin/users">All users →</Link>}
        >
          {data.recentAccounts.length ? (
            <ul className={`${styles.panel} ${styles.list}`}>
              {data.recentAccounts.map((user) => (
                <li key={user.id} className={styles.activityRow}>
                  <Link href={`/admin/users/${user.id}`}>{user.email}</Link>
                  <small title={formatAdminInstant(user.createdAt)}>
                    {formatAdminRelative(user.createdAt)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.compactEmpty}>No accounts yet.</p>
          )}
        </AdminSection>
      </div>
    </AdminShell>
  );
}
