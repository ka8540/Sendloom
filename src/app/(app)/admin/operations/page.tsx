import { getSystemHealth } from "@/lib/system-health";
import {
  AdminSection,
  AdminStatusBadge,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
import { formatAdminInstant } from "@/components/admin-v2/format";
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
        description={`Checked ${formatAdminInstant(health.timestamp)}`}
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
        <div className={styles.healthGrid}>
          {rows.map((row) => (
            <article className={styles.panel} key={row.name}>
              <div className={styles.activityRow}>
                <strong>{row.name}</strong>
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
              </div>
              <p className={styles.muted}>{row.message}</p>
            </article>
          ))}
        </div>
      </AdminSection>
      <p className="muted">
        Configuration checks show presence only. Processor runs are not inferred
        from credential configuration.
      </p>
    </>
  );
}
