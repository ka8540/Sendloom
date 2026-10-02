import { getDiscoverOperations } from "@/services/admin-v2/operations";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
export default async function DiscoverPage() {
  const data = await getDiscoverOperations();
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
        title="Source and processing"
        description="Persisted provenance and expansion states"
      >
        <AdminTable headings={["Measure", "Count"]}>
          <tr>
            <td>Durable reuse</td>
            <td>{data.reuse}</td>
          </tr>
          <tr>
            <td>External discovery</td>
            <td>{data.external}</td>
          </tr>
          {data.expansionStates.map((row) => (
            <tr key={row.status}>
              <td>Expansion: {row.status}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </AdminTable>
      </AdminSection>
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
                <td>{new Date(row.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No failed searches recorded.</AdminEmptyState>
        )}
      </AdminSection>
    </>
  );
}
