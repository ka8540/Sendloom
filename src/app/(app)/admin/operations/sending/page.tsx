import Link from "next/link";
import { getSendingOperations } from "@/services/admin-v2/operations";
import {
  AdminRankedBars,
  AdminTimeChart,
} from "@/components/admin-v2/admin-charts";
import { formatAdminInstant } from "@/components/admin-v2/format";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
export default async function SendingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const data = await getSendingOperations(
    Number((await searchParams).page) || 1,
  );
  const state = (s: string) =>
    data.states.find((row) => row.status === s)?.count ?? 0;
  return (
    <>
      <AdminMetricStrip
        items={[
          { label: "Confirmed sends · 24h", value: data.confirmedSends },
          { label: "Active runs", value: state("RUNNING") },
          {
            label: "Waiting runs",
            value: state("QUEUED") + state("WAITING_FOR_SLOT"),
          },
          {
            label: "Failed jobs · 24h",
            value: data.failedJobs,
            tone: data.failedJobs ? "warning" : undefined,
          },
        ]}
      />
      <AdminSection
        title="Sending activity"
        description="Confirmed sends and newly created sequence runs by UTC day, last 7 days"
      >
        <div className={styles.panel}>
          <AdminTimeChart
            data={data.trend}
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
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Run states"
          description="Current sequence execution state"
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Runs"
              items={data.states.map((row) => ({
                name: row.status.replaceAll("_", " "),
                value: row.count,
              }))}
            />
          </div>
        </AdminSection>
        <AdminSection
          title="Sender health"
          description="Connected and review-required sender profiles"
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Sender profiles"
              items={[
                { name: "Connected", value: data.connectedSenders },
                { name: "Review", value: data.senderIssues },
              ]}
            />
            <div className={styles.inlineStats}>
              <span>
                Skipped recipients · 24h{" "}
                <strong>{data.skippedJobs.toLocaleString()}</strong>
              </span>
              <span>
                Paused runs <strong>{state("PAUSED").toLocaleString()}</strong>
              </span>
            </div>
          </div>
        </AdminSection>
      </div>
      <AdminSection
        title="Recent failed runs"
        description="No recipient content is shown"
      >
        {data.recentFailures.length ? (
          <AdminTable
            headings={["Sequence", "Owner", "Failed jobs", "Updated"]}
          >
            {data.recentFailures.map((run) => (
              <tr key={run.id}>
                <td>{run.campaign.name}</td>
                <td>
                  {run.campaign.user ? (
                    <Link href={`/admin/users/${run.campaign.user.id}`}>
                      {run.campaign.user.email}
                    </Link>
                  ) : (
                    "Deleted account"
                  )}
                </td>
                <td>{run.failedCount}</td>
                <td>{formatAdminInstant(run.updatedAt)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No failed runs recorded.</AdminEmptyState>
        )}
      </AdminSection>
      <AdminPagination
        {...data.failurePagination}
        href={(page) => `/admin/operations/sending?page=${page}`}
      />
    </>
  );
}
