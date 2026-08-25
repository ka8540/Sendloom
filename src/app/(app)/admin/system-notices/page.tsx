import { requireAdminUser } from "@/lib/auth";

import { SystemNoticesWorkspace } from "./system-notices-workspace";
import styles from "./system-notices.module.css";

export default async function AdminSystemNoticesPage() {
  await requireAdminUser();

  return (
    <div className={styles.page}>
      <SystemNoticesWorkspace />
    </div>
  );
}
