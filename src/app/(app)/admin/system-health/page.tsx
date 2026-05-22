import { AdminSystemHealthSection } from "@/app/(app)/admin/admin-workspace";
import { requireAdminUser } from "@/lib/auth";
import { getSystemHealth } from "@/lib/system-health";

import styles from "@/app/(app)/admin/page.module.css";

export default async function AdminSystemHealthPage() {
  await requireAdminUser();
  const systemHealth = await getSystemHealth();

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 className={styles.heroTitle}>System health</h1>
        <p className="muted">Monitor infrastructure runtime checks and service configuration status.</p>
      </section>

      <AdminSystemHealthSection systemHealth={systemHealth} />
    </div>
  );
}
