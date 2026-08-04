"use client";

import Link from "next/link";
import { ArrowUpRight, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";

import type { SequenceRowData } from "@/components/dashboard/types";
import { SequenceRowActions } from "./sequence-row-actions";
import styles from "./overview-command-center.module.css";

export function SequenceRow({
  sequence,
  onRelaunch,
  tourTarget = false
}: {
  sequence: SequenceRowData;
  onRelaunch: () => void;
  tourTarget?: boolean;
}) {
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
      data-overview-tour={tourTarget ? "recent-sequence-card" : undefined}
    >
      <span className={styles.sequenceGlyph} aria-hidden="true">
        <Send aria-hidden="true" />
      </span>

      <div className={styles.sequenceInfo}>
        <h3 className={styles.sequenceName}>{sequence.name}</h3>
        <div className={styles.sequenceMeta} title={sequence.summary}>
          <span className={styles.sequenceMetaChip} title={sequence.meta.list}>
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

      <span
        className={styles.sequenceStatus}
        data-tone={sequence.statusTone}
        title={sequence.health.hint ?? sequence.health.label}
        aria-label={sequence.health.ariaLabel}
      >
        {sequence.statusLabel}
      </span>

      <time className={styles.sequenceTime} dateTime={sequence.lastActivityAt}>
        {sequence.lastActivityLabel}
      </time>

      <div className={styles.sequenceActions}>
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
        <Link
          href={sequence.href}
          className={`${styles.actionButton} ${styles.actionButtonOpen}`}
          aria-label={`Open ${sequence.name}`}
          title="Open"
          onClick={(event) => event.stopPropagation()}
        >
          <ArrowUpRight aria-hidden="true" />
          <span className={styles.actionLabel}>Open</span>
        </Link>
      </div>
    </article>
  );
}
