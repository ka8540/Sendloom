"use client";

import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import type { SequenceHealthTone, SequenceRowData } from "@/components/dashboard/types";
import { SequenceRowActions } from "./sequence-row-actions";
import styles from "./overview-command-center.module.css";

const HEALTH_TONE_CLASS: Record<SequenceHealthTone, string> = {
  clean: styles.sequenceHealthClean,
  issues: styles.sequenceHealthIssues,
  syncing: styles.sequenceHealthSyncing,
  idle: styles.sequenceHealthIdle
};

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
            <div className={styles.sequenceMeta} title={sequence.summary}>
              <span
                className={`${styles.sequenceMetaChip} ${styles.sequenceMetaChipPrimary}`}
                title={sequence.meta.list}
              >
                {sequence.meta.list}
              </span>
              <span className={styles.sequenceMetaChip} title={sequence.meta.template}>
                {sequence.meta.template}
              </span>
              <span className={styles.sequenceMetaChip} title={sequence.meta.sender}>
                {sequence.meta.sender}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.sequenceProgressGroup}>
          <dl className={styles.sequenceMetrics}>
            {sequence.metrics.map((metric) => (
              <div
                key={metric.key}
                className={`${styles.sequenceMetric}${metric.tone === "issues" ? ` ${styles.sequenceMetricIssues}` : ""}`}
              >
                <dt className={styles.sequenceMetricLabel}>{metric.label}</dt>
                <dd className={styles.sequenceMetricValue}>{metric.value}</dd>
              </div>
            ))}
          </dl>
          <div
            className={`${styles.sequenceProgressTrack}${sequence.health.tone === "syncing" ? ` ${styles.sequenceProgressTrackSyncing}` : ""}`}
            aria-hidden="true"
          >
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
            <p className={`${styles.sequenceHealth} ${HEALTH_TONE_CLASS[sequence.health.tone]}`}>
              <span className={styles.sequenceHealthDot} aria-hidden="true" />
              {sequence.health.label}
            </p>
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
