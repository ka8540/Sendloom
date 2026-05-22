import { AdminRestrictionsSection } from "@/app/(app)/admin/admin-workspace";
import { requireAdminUser } from "@/lib/auth";
import { listAdminUsers } from "@/services/admin";

import styles from "@/app/(app)/admin/page.module.css";

export default async function AdminRestrictionsPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  const [admin, users, resolvedParams] = await Promise.all([
    requireAdminUser(),
    listAdminUsers(),
    searchParams,
  ]);

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 className={styles.heroTitle}>Restrictions</h1>
        <p className="muted">Manage account-level restrictions and access controls safely.</p>
      </section>

      <AdminRestrictionsSection
        users={users}
        adminId={admin.id}
        initialUserId={resolvedParams.userId ?? null}
      />
    </div>
  );
}
