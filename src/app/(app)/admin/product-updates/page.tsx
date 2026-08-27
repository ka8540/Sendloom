import { requireAdminUser } from "@/lib/auth";

import { ProductUpdatesWorkspace } from "./product-updates-workspace";
import styles from "./product-updates.module.css";

export default async function AdminProductUpdatesPage() {
  await requireAdminUser();

  return (
    <div className={styles.page}>
      <ProductUpdatesWorkspace />
    </div>
  );
}
