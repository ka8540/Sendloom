import Link from "next/link";
import {
  Activity,
  CircleCheck,
  FilePenLine,
  FileSpreadsheet,
  MessageSquareReply,
  SendHorizontal,
  ShieldBan,
  Trash2,
  TriangleAlert,
  Workflow
} from "lucide-react";

import type { ActivityItem } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

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
        <ol className={styles.activityList} aria-label="Recent activity timeline">
          {items.map((item) => {
            const Icon = getActivityIcon(item);
            const visualTone = getActivityTone(item);

            return (
              <li key={item.id} className={styles.activityTimelineEntry}>
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
                      <time className={styles.activityTime} title={item.timeDetail}>
                        {item.timeLabel}
                      </time>
                    </span>
                    <span className={styles.activityLog} title={item.description}>
                      <span className={styles.activityLogPrefix}>System log:</span> {item.description}
                    </span>
                    <span className={styles.activityTimeDetail}>{item.timeDetail}</span>
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

function getActivityIcon(item: ActivityItem) {
  const activityText = `${item.title} ${item.description}`.toLowerCase();

  if (isFailureActivity(item, activityText)) {
    return TriangleAlert;
  }

  if (matchesAny(activityText, ["deleted", "removed", "trashed"])) {
    return Trash2;
  }

  if (item.kind === "suppression") {
    return ShieldBan;
  }

  if (item.kind === "import") {
    return FileSpreadsheet;
  }

  if (item.kind === "template") {
    return FilePenLine;
  }

  if (item.kind === "run") {
    if (matchesAny(activityText, ["reply", "replied", "response received"])) {
      return MessageSquareReply;
    }

    if (matchesAny(activityText, ["ready", "validated"])) {
      return CircleCheck;
    }

    if (matchesAny(activityText, ["send", "sending", "sent", "launch", "launched", "running", "queued"])) {
      return SendHorizontal;
    }

    return Workflow;
  }

  if (matchesAny(activityText, ["template", "copy refreshed"])) {
    return FilePenLine;
  }

  if (matchesAny(activityText, ["import", ".csv", ".xlsx", ".xls", "rows are ready", "list ready", "mapping ready"])) {
    return FileSpreadsheet;
  }

  if (matchesAny(activityText, ["suppression", "unsubscribe", "blocked"])) {
    return ShieldBan;
  }

  if (matchesAny(activityText, ["ready", "validated"])) {
    return CircleCheck;
  }

  if (matchesAny(activityText, ["reply", "replied", "response received"])) {
    return MessageSquareReply;
  }

  if (matchesAny(activityText, ["sequence", "campaign", "launch", "launched", "send", "sending", "sent"])) {
    return SendHorizontal;
  }

  return Activity;
}

function getActivityTone(item: ActivityItem): ActivityItem["tone"] {
  const title = item.title.toLowerCase();

  if (item.tone === "warning" || title.includes("failed") || title.includes("issue") || title.includes("error")) {
    return "warning";
  }

  if (item.tone === "success" || title.includes("ready") || title.includes("validated")) {
    return "success";
  }

  return item.tone;
}

function isFailureActivity(item: ActivityItem, activityText: string) {
  return item.tone === "warning" || matchesAny(activityText, ["failed", "failure", "error", "issue"]);
}

function matchesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}
