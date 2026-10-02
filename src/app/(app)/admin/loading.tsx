import {
  AdminShell,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
export default function AdminLoading() {
  return (
    <AdminShell>
      <div
        className={styles.panel}
        aria-busy="true"
        aria-label="Loading admin workspace"
        style={{ minHeight: "7rem" }}
      />
      <div className={styles.metrics} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className={styles.metric} key={i}>
            <span>Loading…</span>
            <strong>—</strong>
          </div>
        ))}
      </div>
      <div
        className={styles.panel}
        aria-hidden="true"
        style={{ minHeight: "18rem" }}
      />
    </AdminShell>
  );
}
