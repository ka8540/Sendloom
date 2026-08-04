import Link from "next/link";
import { Activity } from "lucide-react";

import { getActivityIcon, getActivityTone } from "@/components/dashboard/activity-icons";
import type { ActivityItem } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className={styles.activitySection} data-overview-tour="live-system">
      <div className={styles.activityHead}>
        <h2 className={styles.sideTitle}>Recent activity</h2>
      </div>

      {items.length ? (
        <ol className={styles.activityList} aria-label="Recent activity">
          {items.map((item, index) => {
            const Icon = getActivityIcon(item);
            const visualTone = getActivityTone(item);

            return (
              <li
                key={item.id}
                className={styles.activityEntry}
                data-overview-tour={index === 0 ? "activity-row" : undefined}
              >
                <Link href={item.href} className={styles.activityItem}>
                  <span className={styles.activityIcon} data-tone={visualTone} aria-hidden="true">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className={styles.activityContent}>
                    <span className={styles.activityTitle} title={item.title}>
                      {item.title}
                    </span>
                    <span className={styles.activityCopy} title={item.description}>
                      {item.description}
                    </span>
                  </span>
                  <time className={styles.activityTime} dateTime={item.timeValue}>
                    {item.timeLabel}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className={styles.activityEmpty}>
          <span className={styles.activityEmptyIcon}>
            <Activity aria-hidden="true" />
          </span>
          <div>
            <strong>No recent activity yet</strong>
            <p>Create or launch a sequence to see updates here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
