import Link from "next/link";
import { Activity, FileSpreadsheet, ScrollText, SendHorizontal, ShieldAlert } from "lucide-react";

import type { ActivityItem } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

const kindIcons = {
  run: SendHorizontal,
  import: FileSpreadsheet,
  template: ScrollText,
  suppression: ShieldAlert
} as const;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className={styles.activitySection}>
      <div className={styles.sectionTop}>
        <div>
          <span className={styles.sectionKicker}>Live system</span>
          <h2 className={styles.sectionTitle}>Recent activity</h2>
          <p className={styles.sectionCopy}>Imports, template edits, suppressions, and send activity land here as they happen.</p>
        </div>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          Flowing now
        </span>
      </div>

      {items.length ? (
        <div className={styles.activityList}>
          {items.map((item) => {
            const Icon = kindIcons[item.kind] ?? Activity;

            return (
              <Link key={item.id} href={item.href} className={styles.activityItem}>
                <span className={`${styles.activityIcon} ${styles[`activityIcon${capitalize(item.tone)}`]}`}>
                  <Icon aria-hidden="true" />
                </span>
                <div className={styles.activityContent}>
                  <div className={styles.activityHeading}>
                    <strong>{item.title}</strong>
                    <span>{item.timeLabel}</span>
                  </div>
                  <p>{item.description}</p>
                  <small>{item.timeDetail}</small>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className={styles.activityEmpty}>
          <Activity aria-hidden="true" />
          <div>
            <strong>No live activity yet</strong>
            <p>Launch a sequence, import a list, or update a template to start building the activity stream.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
