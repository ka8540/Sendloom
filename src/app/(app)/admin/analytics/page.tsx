import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import {
  getAdminAnalytics,
  normalizeAdminRange,
  safeRate,
} from "@/services/admin-v2/analytics";
import {
  AdminTimeChart,
  AdminRankedBars,
} from "@/components/admin-v2/admin-charts";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminTabs,
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
        description="Understand growth, activation, product adoption, and platform usage."
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
          {
            label: "Product users",
            value: data.totalUsers,
            note: "Non-admin accounts",
          },
          { label: `New users · ${days}d`, value: data.newUsers },
          {
            label: `Last seen · ${days}d`,
            value: data.activeUsers,
            note: "Non-admin accounts",
          },
          { label: `Confirmed sends · ${days}d`, value: data.outreach.sends },
        ]}
      />
      <AdminSection
        title="User growth"
        description="New accounts and accounts whose latest activity falls on each UTC day"
      >
        <div className={styles.panel}>
          <AdminTimeChart
            data={data.trend}
            series={[
              {
                key: "newUsers",
                name: "New users",
                color: "var(--analysis-green)",
              },
              {
                key: "lastSeen",
                name: "Last seen",
                color: "var(--analysis-blue)",
              },
            ]}
          />
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Activation funnel"
          description="Persisted milestones measured independently across product users; each bar is a share of all product users"
        >
          <div className={`${styles.panel} ${styles.progressList}`}>
            {data.funnel.map((row) => {
              const rate = safeRate(row.value, data.totalUsers);
              return (
                <div className={styles.progressItem} key={row.label}>
                  <div className={styles.progressMeta}>
                    <strong>{row.label}</strong>
                    <span>
                      {row.value.toLocaleString()} ·{" "}
                      {rate === null ? "—" : `${rate}%`}
                    </span>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="img"
                    aria-label={`${row.label}: ${row.value} accounts, ${rate ?? 0}% of product users`}
                  >
                    <span
                      className={styles.progressFill}
                      style={{ width: `${rate ?? 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </AdminSection>
        <AdminSection
          title="Feature adoption"
          description={`Unique product users over ${days} days; usage totals shown below`}
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Unique users"
              items={data.adoption.map((row) => ({
                name: row.label.replace(" searches", "").replace(" runs", ""),
                value: row.users,
              }))}
            />
            <dl className={styles.dataList}>
              {data.adoption.map((row) => (
                <div key={row.label} className={styles.definitionRow}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.users.toLocaleString()} users ·{" "}
                    {row.value.toLocaleString()} events
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </AdminSection>
      </div>
      <AdminSection
        title="Outreach activity"
        description="Confirmed sends and sequence runs by UTC day. Replies are shown separately to preserve a readable scale."
      >
        <div className={styles.panel}>
          <AdminTimeChart
            data={data.outreachTrend}
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
            ]}
          />
          <div className={styles.inlineStats}>
            <span>
              Matched replies{" "}
              <strong>{data.outreach.replies.toLocaleString()}</strong>
            </span>
            <span>
              Failed jobs{" "}
              <strong>{data.outreach.failedJobs.toLocaleString()}</strong>
            </span>
            <span>
              Skipped recipients{" "}
              <strong>{data.outreach.skipped.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Discover activity"
          description="Search and Add More requests by UTC day"
        >
          <div className={styles.panel}>
            <AdminTimeChart
              data={data.discoverTrend}
              height="small"
              series={[
                {
                  key: "searches",
                  name: "Searches",
                  color: "var(--analysis-green)",
                },
                {
                  key: "expansions",
                  name: "Add More",
                  color: "var(--analysis-purple)",
                },
              ]}
            />
            <div className={styles.inlineStats}>
              <span>
                People allocated{" "}
                <strong>{data.discover.allocations.toLocaleString()}</strong>
              </span>
              <span>
                Failed searches{" "}
                <strong>{data.discover.failedSearches.toLocaleString()}</strong>
              </span>
            </div>
          </div>
        </AdminSection>
        <AdminSection
          title="Search result sources"
          description="Persisted source attribution for Discover searches"
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Searches"
              items={[
                { name: "Durable reuse", value: data.discover.reusedSearches },
                { name: "Provider", value: data.discover.providerSearches },
              ]}
            />
            <div className={styles.inlineStats}>
              <span>
                Provider batches{" "}
                <strong>
                  {data.discover.providerBatches.toLocaleString()}
                </strong>
              </span>
              <Link href="/admin/operations/discover">
                Discover operations →
              </Link>
            </div>
          </div>
        </AdminSection>
      </div>
    </AdminShell>
  );
}
