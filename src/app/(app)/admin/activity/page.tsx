import { requireAdminUser } from "@/lib/auth";
import { searchActivityUsers } from "@/services/admin-activity";

import { AdminActivityWorkspace } from "./activity-workspace";
import styles from "./activity.module.css";

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  const [, initialUsers, resolvedParams] = await Promise.all([
    requireAdminUser(),
    searchActivityUsers(""),
    searchParams,
  ]);

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>User activity</h1>
          <p className="muted">
            Search a user and inspect their actions, objects, and security-relevant events.
          </p>
        </div>
        <div className={styles.heroBadge} title="New events are captured as they happen.">
          <span className={styles.recordingDot} aria-hidden="true" />
          Recording events
        </div>
      </section>

      <AdminActivityWorkspace
        initialUsers={initialUsers}
        initialUserId={resolvedParams.userId ?? null}
      />
    </div>
  );
}
