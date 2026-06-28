import { ShieldCheck } from "lucide-react";

import { requireAdminUser } from "@/lib/auth";

import { AdminIncidentsWorkspace } from "./incidents-workspace";
import styles from "./incidents.module.css";

export default async function AdminIncidentsPage() {
  await requireAdminUser();

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>Incident reports</h1>
          <p className="muted">
            Reports submitted from Sendloom error screens. Each affected account is shown only by a stable anonymous
            code — never a name, email, or any personal data.
          </p>
        </div>
        <div className={styles.heroBadge} title="Reporter identity is never exposed.">
          <ShieldCheck aria-hidden="true" />
          Privacy preserved
        </div>
      </section>

      <AdminIncidentsWorkspace />
    </div>
  );
}
