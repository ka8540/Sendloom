import Link from "next/link";
import { Activity } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import { getActivityIcon, getActivityTone } from "@/components/dashboard/activity-icons";
import type { ActivityItem } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className={styles.activitySection} data-overview-tour="live-system">
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
        <ol className={styles.activityList} aria-label="Recent activity timeline">
          {items.map((item, index) => {
            const Icon = getActivityIcon(item);
            const visualTone = getActivityTone(item);

            return (
              <li
                key={item.id}
                className={styles.activityTimelineEntry}
                data-overview-tour={index === 0 ? "activity-row" : undefined}
              >
                <Link href={item.href} className={styles.activityItem}>
                  <span className={styles.activityTimelineMark} aria-hidden="true">
                    <span className={`${styles.activityIcon} ${styles[`activityIcon${capitalize(visualTone)}`]}`}>
                      <Icon aria-hidden="true" />
                    </span>
                  </span>
                  <span className={styles.activityContent}>
                    <span className={styles.activityHeading}>
                      <strong className={styles.activityTitle} title={item.title}>
                        {item.title}
                      </strong>
                      <time className={styles.activityTime} dateTime={item.timeValue}>
                        {item.timeLabel}
                      </time>
                    </span>
                    <span className={styles.activityLog} title={item.description}>
                      <span className={styles.activityLogPrefix}>System log:</span> {item.description}
                    </span>
                    <LocalDateTime value={item.timeValue} className={styles.activityTimeDetail} />
                  </span>
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
