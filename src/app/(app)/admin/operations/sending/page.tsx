import Link from "next/link";
import { getSendingOperations } from "@/services/admin-v2/operations";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
export default async function SendingPage() {
  const data = await getSendingOperations();
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
        title="Run states"
        description="Current sequence execution state"
      >
        <AdminTable headings={["State", "Runs"]}>
          {data.states.map((row) => (
            <tr key={row.status}>
              <td>
                <AdminStatusBadge
                  status={row.status}
                  tone={
                    row.status === "FAILED"
                      ? "danger"
                      : row.status === "RUNNING"
                        ? "healthy"
                        : "neutral"
                  }
                />
              </td>
              <td>{row.count}</td>
            </tr>
          ))}
        </AdminTable>
      </AdminSection>
      <AdminSection title="Sender and recipient signals">
        <AdminMetricStrip
          items={[
            { label: "Connected senders", value: data.connectedSenders },
            {
              label: "Sender connections requiring review",
              value: data.senderIssues,
              tone: data.senderIssues ? "warning" : undefined,
            },
            { label: "Skipped recipients · 24h", value: data.skippedJobs },
            { label: "Paused runs", value: state("PAUSED") },
          ]}
        />
      </AdminSection>
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
                <td>{new Date(run.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No failed runs recorded.</AdminEmptyState>
        )}
      </AdminSection>
    </>
  );
}
