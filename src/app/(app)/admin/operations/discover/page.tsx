import { getDiscoverOperations } from "@/services/admin-v2/operations";
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
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const data = await getDiscoverOperations(
    Number((await searchParams).page) || 1,
  );
  return (
    <>
      <AdminMetricStrip
        items={[
          { label: "Searches · 24h", value: data.searches },
          { label: "People allocated · 24h", value: data.allocations },
          { label: "Add More · 24h", value: data.expansions },
          {
            label: "Failed searches · 24h",
            value: data.failures,
            tone: data.failures ? "warning" : undefined,
          },
        ]}
      />
      <AdminSection
        title="Search activity"
        description="Searches and failed searches by UTC day, last 7 days"
      >
        <div className={styles.panel}>
          <AdminTimeChart
            data={data.trend}
            series={[
              {
                key: "searches",
                name: "Searches",
                color: "var(--analysis-green)",
              },
              {
                key: "failures",
                name: "Failed searches",
                color: "var(--analysis-orange)",
              },
            ]}
          />
        </div>
      </AdminSection>
      <div className={styles.twoColumn}>
        <AdminSection
          title="Result sources"
          description="Persisted Discover provenance, last 24 hours"
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Searches"
              items={[
                { name: "Durable reuse", value: data.reuse },
                { name: "Provider", value: data.external },
              ]}
            />
          </div>
        </AdminSection>
        <AdminSection
          title="Provider batches"
          description="Persisted provider attribution, last 24 hours"
        >
          <div className={styles.panel}>
            <AdminRankedBars
              label="Batches"
              items={data.providers.map((row) => ({
                name: row.provider,
                value: row.count,
              }))}
            />
          </div>
        </AdminSection>
      </div>
      <AdminSection
        title="Provider batches"
        description="Persisted provider attribution in the last 24 hours"
      >
        {data.providers.length ? (
          <AdminTable headings={["Provider", "Batches"]}>
            {data.providers.map((row) => (
              <tr key={row.provider}>
                <td>{row.provider}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>
            No provider batches recorded in this period.
          </AdminEmptyState>
        )}
      </AdminSection>
      <AdminSection
        title="Recent failed searches"
        description="Search contents and private results are hidden"
      >
        {data.recentFailures.length ? (
          <AdminTable headings={["Search ID", "Code", "Updated"]}>
            {data.recentFailures.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>
                  <AdminStatusBadge
                    status={row.errorCode || "FAILED"}
                    tone="warning"
                  />
                </td>
                <td>{formatAdminInstant(row.updatedAt)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No failed searches recorded.</AdminEmptyState>
        )}
      </AdminSection>
      <AdminPagination
        {...data.failurePagination}
        href={(page) => `/admin/operations/discover?page=${page}`}
      />
    </>
  );
}
