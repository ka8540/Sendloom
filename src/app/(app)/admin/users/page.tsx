import { AdminUsersSection } from "@/app/(app)/admin/admin-workspace";
import { requireAdminUser } from "@/lib/auth";
import { listAdminUsers } from "@/services/admin";

import styles from "@/app/(app)/admin/page.module.css";

export default async function AdminUsersPage() {
  const admin = await requireAdminUser();
  const users = await listAdminUsers();

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 className={styles.heroTitle}>User management</h1>
        <p className="muted">Search, inspect, and manage all user accounts.</p>
      </section>

      <AdminUsersSection users={users} adminId={admin.id} />
    </div>
  );
}
