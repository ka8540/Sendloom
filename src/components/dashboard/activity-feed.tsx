import Link from "next/link";

import { getActivityIcon, getActivityTone } from "@/components/dashboard/activity-icons";
import type { ActivityItem } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

// Presentation-only cap: the Overview panel shows just the newest few events so
// it stays compact beside the send-window card. The builder's ordering and the
// underlying records are untouched — the rest stay available on their own pages.
const OVERVIEW_ACTIVITY_LIMIT = 4;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  // items arrive newest-first from buildActivityItems; take the leading slice.
  const visibleItems = items.slice(0, OVERVIEW_ACTIVITY_LIMIT);

  return (
    <section className={styles.activitySection} data-overview-tour="live-system">
      <div className={styles.activityHead}>
        <h2 className={styles.sideTitle}>Recent activity</h2>
      </div>

      {visibleItems.length ? (
        <ol className={styles.activityList} aria-label="Recent activity">
          {visibleItems.map((item, index) => {
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
        <p className={styles.activityEmpty}>No recent activity yet.</p>
      )}
    </section>
  );
}
