"use client";

import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import type { SequenceRowData } from "@/components/dashboard/types";
import { SequenceRowActions } from "./sequence-row-actions";
import styles from "./overview-command-center.module.css";

export function SequenceRow({ sequence, onRelaunch }: { sequence: SequenceRowData; onRelaunch: () => void }) {
  const router = useRouter();

  function navigate() {
    router.push(sequence.href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate();
    }
  }

  return (
    <article
      className={styles.sequenceRow}
      role="link"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${sequence.name}`}
    >
      <div className={styles.sequenceMain}>
        <div className={styles.sequenceIdentity}>
          <div className={styles.sequenceTitleBlock}>
            <h3 className={styles.sequenceName}>{sequence.name}</h3>
            <p className={styles.sequenceSummary}>{sequence.summary}</p>
          </div>
        </div>

        <div className={styles.sequenceProgressGroup}>
          <div className={styles.sequenceProgressMeta}>
            <span>{sequence.progressLabel}</span>
            <strong>{sequence.deliveryLabel}</strong>
          </div>
          <div className={styles.sequenceProgressTrack} aria-hidden="true">
            <span className={styles.sequenceProgressFill} style={{ width: `${sequence.progressPercent}%` }} />
          </div>
          {sequence.dailyLimitBlock ? (
            <p className={styles.sequenceLimitNote} title="Paused by Gmail safety limit">
              <ShieldAlert aria-hidden="true" />
              <span className={styles.sequenceLimitText}>Safety pause</span>
              {sequence.dailyLimitBlock.resumesAt ? (
                <span className={styles.sequenceLimitResume}>
                  resumes <LocalDateTime value={sequence.dailyLimitBlock.resumesAt} variant="time" />
                </span>
              ) : null}
            </p>
          ) : (
            <p className={styles.sequenceDeliveryDetail}>{sequence.deliveryDetail}</p>
          )}
        </div>
      </div>

      <div className={styles.sequenceSidebar}>
        <div className={styles.sequenceSidebarTop}>
          <span className={`${styles.sequenceStatus} ${styles[`sequenceStatus${capitalize(sequence.statusTone)}`]}`}>
            {sequence.statusLabel}
          </span>

          <div className={styles.sequenceActivity}>
            <span>Last activity</span>
            <strong>{sequence.lastActivityLabel}</strong>
            <small>
              <LocalDateTime value={sequence.lastActivityAt} />
            </small>
          </div>
        </div>

        <div className={styles.sequenceInteractiveRail}>
          <SequenceRowActions
            href={sequence.href}
            campaignId={sequence.id}
            campaignName={sequence.name}
            canRelaunch={sequence.canRelaunch}
            isActiveRun={sequence.isActiveRun}
            isPausedRun={sequence.isPausedRun}
            isDailyLimitBlocked={Boolean(sequence.dailyLimitBlock)}
            onRelaunch={onRelaunch}
          />
          <span className={styles.sequenceArrow}>
            <ArrowUpRight aria-hidden="true" />
          </span>
        </div>
      </div>
    </article>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
