import { getSystemHealth } from "@/lib/system-health";
import {
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
import { AdminHealthRefresh } from "@/components/admin-v2/health-refresh";
export default async function PlatformPage() {
  const health = await getSystemHealth();
  const rows = Object.entries(health.checks).map(([key, check]) => ({
    name: key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
    ...check,
  }));
  return (
    <>
      <AdminSection
        title="Platform status"
        description={`Checked ${new Date(health.timestamp).toLocaleString()}`}
        action={<AdminHealthRefresh />}
      >
        <AdminStatusBadge
          status={health.status}
          tone={
            health.status === "ok"
              ? "healthy"
              : health.status === "down"
                ? "danger"
                : "warning"
          }
        />
        <AdminTable headings={["Service", "Status", "Details"]}>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>
                <AdminStatusBadge
                  status={row.status}
                  tone={
                    row.status === "ok" || row.status === "configured"
                      ? "healthy"
                      : row.status === "down"
                        ? "danger"
                        : "warning"
                  }
                />
              </td>
              <td>{row.message}</td>
            </tr>
          ))}
        </AdminTable>
      </AdminSection>
      <p className="muted">
        Configuration checks show presence only. Processor runs are not inferred
        from credential configuration.
      </p>
    </>
  );
}
