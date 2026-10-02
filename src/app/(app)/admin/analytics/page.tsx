import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import {
  getAdminAnalytics,
  normalizeAdminRange,
  safeRate,
} from "@/services/admin-v2/analytics";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminTabs,
  AdminTable,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdminUser();
  const days = normalizeAdminRange((await searchParams).range);
  const data = await getAdminAnalytics(days);
  return (
    <AdminShell>
      <AdminPageHeader
        title="Analytics"
        description="How Sendloom is being adopted and used across accounts."
      />
      <AdminTabs
        active={`/admin/analytics?range=${days}`}
        items={[7, 30, 90].map((range) => ({
          label: `${range}D`,
          href: `/admin/analytics?range=${range}`,
        }))}
      />
      <AdminMetricStrip
        items={[
          { label: "Total users", value: data.totalUsers },
          { label: `New users · ${days}d`, value: data.newUsers },
          { label: `Active users · ${days}d`, value: data.activeUsers },
          { label: "Confirmed sends", value: data.outreach.sends },
        ]}
      />
      <AdminSection
        title="New users over time"
        description="UTC signup dates for non-admin accounts"
      >
        <div className={styles.panel}>
          <div
            className={styles.sparkline}
            role="img"
            aria-label={`New users by day over the last ${days} days`}
          >
            {data.trend.map((row) => (
              <span
                key={row.day}
                title={`${row.day}: ${row.count} new users`}
                style={{
                  height: `${Math.max(3, (row.count / Math.max(1, ...data.trend.map((item) => item.count))) * 100)}%`,
                }}
              />
            ))}
          </div>
          <p className={styles.muted}>
            {data.trend[0]?.day} → {data.trend.at(-1)?.day}
          </p>
        </div>
      </AdminSection>
      <div className={styles.split}>
        <AdminSection
          title="Activation funnel"
          description="Current persisted milestones for non-admin accounts"
        >
          <AdminTable headings={["Stage", "Accounts", "Of signups"]}>
            {data.funnel.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.value.toLocaleString()}</td>
                <td>
                  {safeRate(row.value, data.totalUsers) === null
                    ? "—"
                    : `${safeRate(row.value, data.totalUsers)}%`}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminSection>
        <AdminSection
          title="Feature adoption"
          description={`Recorded activity over ${days} days`}
        >
          <AdminTable headings={["Feature", "Unique users", "Usage"]}>
            {data.adoption.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.users.toLocaleString()}</td>
                <td>{row.value.toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminSection>
      </div>
      <div className={styles.split}>
        <AdminSection title="Outreach platform">
          <AdminTable headings={["Measure", "Count"]}>
            {Object.entries({
              "Sequence runs": data.outreach.campaigns,
              "Matched replies": data.outreach.replies,
              "Skipped recipients": data.outreach.skipped,
              "Failed jobs": data.outreach.failedJobs,
              "Connected senders": data.outreach.connectedSenders,
            }).map(([name, value]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{value.toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminSection>
        <AdminSection title="Discover">
          <AdminTable headings={["Measure", "Count"]}>
            {Object.entries({
              Searches: data.discover.searches,
              "People allocated": data.discover.allocations,
              "Add More actions": data.discover.expansions,
              "Failed searches": data.discover.failedSearches,
              "New provider batches": data.discover.providerBatches,
            }).map(([name, value]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{value.toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
          <p className={styles.muted}>
            For operational details,{" "}
            <Link href="/admin/operations/discover">
              open Discover operations
            </Link>
            .
          </p>
        </AdminSection>
      </div>
    </AdminShell>
  );
}
