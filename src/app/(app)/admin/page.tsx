import { AdminOverviewSection } from "@/app/(app)/admin/admin-workspace";
import { requireAdminUser } from "@/lib/auth";
import { getSystemHealth } from "@/lib/system-health";
import { listAdminUsers } from "@/services/admin";

import styles from "./page.module.css";

export default async function AdminOverviewPage() {
  const admin = await requireAdminUser();
  const [users, systemHealth] = await Promise.all([listAdminUsers(), getSystemHealth()]);

  const metrics = {
    totalUsers: users.length,
    loggedInUsers: users.filter((user) => user.isLoggedIn).length,
    restrictedUsers: users.filter(
      (user) =>
        user.apiAccessDisabled ||
        user.importsWriteDisabled ||
        user.templatesWriteDisabled ||
        user.launchesDisabled ||
        user.aiEnhancementsDisabled
    ).length,
    connectedSenders: users.reduce((sum, user) => sum + user.counts.senderProfiles, 0),
  };

  const footprint = [
    { label: "Imports", value: users.reduce((sum, user) => sum + user.counts.imports, 0) },
    { label: "Mappings", value: users.reduce((sum, user) => sum + user.counts.mappings, 0) },
    { label: "Templates", value: users.reduce((sum, user) => sum + user.counts.templates, 0) },
    { label: "Campaigns", value: users.reduce((sum, user) => sum + user.counts.campaigns, 0) },
    { label: "Senders", value: metrics.connectedSenders },
    { label: "Suppressions", value: users.reduce((sum, user) => sum + user.counts.suppressions, 0) },
  ];

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <h1 className={styles.heroTitle}>Admin overview</h1>
        <p className="muted">
          High-level snapshot of user activity, account health, and infrastructure status.
        </p>
      </section>

      <AdminOverviewSection
        metrics={metrics}
        systemHealth={systemHealth}
        adminEmail={admin.email}
        footprint={footprint}
      />
    </div>
  );
}
