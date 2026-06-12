"use client";

import { CornerDownRight, Paperclip, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "@/app/landing.module.css";

/* Purely illustrative mock data for the marketing visual. The board "runs"
   on a slow tick while visible: rows enter at the top, status pills evolve
   as a row ages, and the queue progress creeps forward. The interval only
   exists while the board is on screen and motion is allowed. */

const TICK_MS = 2800;
const VISIBLE_ROWS = 5;
const QUEUE_STEPS = 6;

type RecipientStatus = "queued" | "sent" | "opened" | "replied" | "retry";

const STATUS_LABEL: Record<RecipientStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  opened: "Opened",
  replied: "Replied",
  retry: "Retry queued"
};

const statusClass: Record<RecipientStatus, string> = {
  queued: styles.statusQueued,
  sent: styles.statusSent,
  opened: styles.statusOpened,
  replied: styles.statusReplied,
  retry: styles.statusRetry
};

type PoolEntry = {
  name: string;
  company: string;
  /* Delivery story indexed by row age: each recipient's status evolves as
     the row drifts down the list. */
  story: readonly RecipientStatus[];
};

const recipientPool: readonly PoolEntry[] = [
  { name: "Maya Chen", company: "Northwind", story: ["queued", "sent", "opened", "replied", "replied"] },
  { name: "Daniel Rosa", company: "Helio Labs", story: ["queued", "sent", "sent", "opened", "opened"] },
  { name: "Priya Nair", company: "Brightforge", story: ["queued", "sent", "opened", "opened", "replied"] },
  { name: "Tom Becker", company: "Cedarline", story: ["queued", "retry", "sent", "opened", "opened"] },
  { name: "Lena Ortiz", company: "Quanta", story: ["queued", "sent", "opened", "replied", "replied"] },
  { name: "Ada Veld", company: "Mirelle", story: ["queued", "sent", "sent", "opened", "replied"] },
  { name: "Noah Brandt", company: "Fjordline", story: ["queued", "sent", "opened", "opened", "opened"] },
  { name: "Sofia Marini", company: "Lanterna", story: ["queued", "sent", "opened", "replied", "replied"] }
] as const;

const queueItems = [
  { who: "Anna Lee", step: "Intro" },
  { who: "Jonas Kim", step: "Intro" },
  { who: "Rita Paz", step: "Follow-up 1" }
] as const;

const followUps = [
  { label: "Initial send", timing: "Sent today", state: "done" as const },
  { label: "Follow-up 1", timing: "in 2 days", state: "next" as const },
  { label: "Follow-up 2", timing: "in 5 days", state: "scheduled" as const }
];

const safetyChecks = [
  { label: "List validated", detail: "Columns mapped, duplicates flagged" },
  { label: "Sender connected", detail: "Your Gmail via Google OAuth" },
  { label: "Pacing active", detail: "Sends spaced inside the window" },
  { label: "Suppressions applied", detail: "Unsubscribes excluded from the run" }
] as const;

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function LandingCommandCenter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    let interval: number | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          interval ??= window.setInterval(() => setTick((current) => current + 1), TICK_MS);
        } else if (interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, []);

  const poolSize = recipientPool.length;
  const rows = Array.from({ length: VISIBLE_ROWS }, (_, age) => {
    const entry = recipientPool[(((tick - age) % poolSize) + poolSize) % poolSize];
    const status = entry.story[Math.min(age, entry.story.length - 1)];
    return { ...entry, status, fresh: age === 0 && tick > 0 };
  });

  const queueActive = tick % queueItems.length;
  const queueProgress = ((tick % QUEUE_STEPS) + 1) / QUEUE_STEPS;

  return (
    <div ref={rootRef} className={styles.board}>
      <span className={styles.boardGlow} aria-hidden="true" />

      <header className={styles.boardBar}>
        <span className={styles.boardDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className={styles.boardTitle}>
          <strong>Q2 Founders · Outbound</strong>
          <span>Connected sender · send window 09:00–17:00</span>
        </div>
        <span className={styles.boardBadge}>Illustrative preview</span>
      </header>

      <div className={styles.boardGrid}>
        <article className={`${styles.boardCard} ${styles.boardHealth}`}>
          <span className={styles.boardCardLabel}>Sequence health</span>
          <div className={styles.healthRow}>
            <svg className={styles.healthRing} viewBox="0 0 120 120" aria-hidden="true">
              <circle className={styles.healthTrack} cx="60" cy="60" r="50" />
              <circle className={styles.healthValue} cx="60" cy="60" r="50" pathLength={100} />
            </svg>
            <div className={styles.healthMeta}>
              <strong>On track</strong>
              <span>No delivery failures blocking the run.</span>
            </div>
          </div>
          <ul className={styles.healthLegend}>
            <li>
              <span className={styles.legendQueued} aria-hidden="true" />
              Queued
            </li>
            <li>
              <span className={styles.legendSent} aria-hidden="true" />
              Sent
            </li>
            <li>
              <span className={styles.legendOpened} aria-hidden="true" />
              Opened
            </li>
            <li>
              <span className={styles.legendReplied} aria-hidden="true" />
              Replied
            </li>
          </ul>
        </article>

        <article className={`${styles.boardCard} ${styles.boardActivity}`}>
          <span className={styles.boardCardLabel}>Recipient activity</span>
          <ul className={styles.activityList}>
            {rows.map((recipient) => (
              <li
                key={recipient.name}
                className={styles.activityRow}
                data-fresh={recipient.fresh ? "" : undefined}
              >
                <span className={styles.activityAvatar} aria-hidden="true">
                  {initials(recipient.name)}
                </span>
                <span className={styles.activityWho}>
                  <strong>{recipient.name}</strong>
                  <span>{recipient.company}</span>
                </span>
                <span
                  key={`${recipient.name}-${recipient.status}`}
                  className={`${styles.activityStatus} ${statusClass[recipient.status]}`}
                >
                  {STATUS_LABEL[recipient.status]}
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className={`${styles.boardCard} ${styles.boardQueue}`}>
          <span className={styles.boardCardLabel}>Send queue</span>
          <div className={styles.queueHead}>
            <strong>Morning window</strong>
            <span className={styles.queuePace}>
              <span className={styles.queuePaceDot} aria-hidden="true" />
              Paced · steady
            </span>
          </div>
          <div className={styles.queueBar} aria-hidden="true">
            <span className={styles.queueBarFill} style={{ transform: `scaleX(${queueProgress})` }} />
          </div>
          <ul className={styles.queueList}>
            {queueItems.map((item, index) => {
              const state = index < queueActive ? "done" : index === queueActive ? "sending" : "queued";
              return (
                <li key={item.who} className={styles.queueItem} data-state={state}>
                  <span className={styles.queueItemDot} aria-hidden="true" />
                  <span className={styles.queueItemText}>
                    <strong>{item.who}</strong>
                    <span>{item.step}</span>
                  </span>
                  <span className={styles.queueItemState}>
                    {state === "done" ? "Sent" : state === "sending" ? "Sending" : "Queued"}
                  </span>
                </li>
              );
            })}
          </ul>
        </article>

        <article className={`${styles.boardCard} ${styles.boardTemplate}`}>
          <span className={styles.boardCardLabel}>Template preview</span>
          <div className={styles.templateSubject}>
            <span>Subject</span>
            <strong>Quick idea for {"{{company}}"}</strong>
          </div>
          <p className={styles.templateBody}>
            Hi {"{{first_name}}"}, I noticed {"{{company}}"} is scaling outbound and wanted to share a faster way to run
            the whole sequence from one place…
            <span className={styles.templateCaret} aria-hidden="true" />
          </p>
          <div className={styles.templateTags}>
            <span>HTML</span>
            <span>{"{{first_name}}"}</span>
            <span>{"{{company}}"}</span>
          </div>
        </article>

        <article className={`${styles.boardCard} ${styles.boardFollow}`}>
          <span className={styles.boardCardLabel}>Follow-up timing</span>
          <ul className={styles.followList}>
            {followUps.map((step) => (
              <li key={step.label} className={styles.followStep} data-state={step.state}>
                <span className={styles.followIcon} aria-hidden="true">
                  <CornerDownRight strokeWidth={1.9} />
                </span>
                <span className={styles.followText}>
                  <strong>{step.label}</strong>
                  <span>{step.timing}</span>
                </span>
                {step.state === "next" ? <span className={styles.followNext}>Next</span> : null}
              </li>
            ))}
          </ul>
        </article>

        <article className={`${styles.boardCard} ${styles.boardSafety}`}>
          <span className={styles.boardCardLabel}>Safety status</span>
          <ul className={styles.safetyList}>
            {safetyChecks.map((check) => (
              <li key={check.label} className={styles.safetyItem}>
                <span className={styles.safetyIcon} aria-hidden="true">
                  <ShieldCheck strokeWidth={1.9} />
                </span>
                <span className={styles.safetyText}>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.attachmentChip}>
            <Paperclip strokeWidth={1.9} aria-hidden="true" />
            <strong>deck-overview.pdf</strong>
            <span>attached to template</span>
          </div>
        </article>
      </div>
    </div>
  );
}
