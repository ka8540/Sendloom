import { WhatsNewView } from "@/components/product-updates/whats-new-view";
import { requireUser } from "@/lib/auth";
import { listPublishedProductUpdates, PRODUCT_UPDATE_USER_PAGE_SIZE } from "@/services/product-updates";

import styles from "./page.module.css";

export default async function WhatsNewPage() {
  const user = await requireUser();
  const page = await listPublishedProductUpdates(user.id, { limit: PRODUCT_UPDATE_USER_PAGE_SIZE });

  return (
    <div className={styles.page}>
      <WhatsNewView initialItems={page.items} initialNextCursor={page.nextCursor} />
    </div>
  );
}
