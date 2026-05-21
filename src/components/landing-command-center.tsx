import { CornerDownRight } from "lucide-react";

import styles from "@/app/landing.module.css";

type RecipientStatus = "replied" | "opened" | "sent" | "retry";

const recipients: { name: string; company: string; status: RecipientStatus; label: string }[] = [
  { name: "Maya Chen", company: "Northwind", status: "replied", label: "Replied" },
  { name: "Daniel Rosa", company: "Helio Labs", status: "opened", label: "Opened" },
  { name: "Priya Nair", company: "Brightforge", status: "sent", label: "Sent" },
  { name: "Tom Becker", company: "Cedarline", status: "retry", label: "Retry queued" },
  { name: "Lena Ortiz", company: "Quanta", status: "opened", label: "Opened" }
];

const followUps = [
  { label: "Initial send", timing: "Sent today", state: "done" as const },
  { label: "Follow-up 1", timing: "in 2 days", state: "scheduled" as const },
  { label: "Follow-up 2", timing: "in 5 days", state: "scheduled" as const }
];

const statusClass: Record<RecipientStatus, string> = {
  replied: styles.statusReplied,
  opened: styles.statusOpened,
  sent: styles.statusSent,
  retry: styles.statusRetry
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function LandingCommandCenter() {
  return (
    <div className={styles.board}>
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
            {recipients.map((recipient) => (
              <li key={recipient.name} className={styles.activityRow}>
                <span className={styles.activityAvatar} aria-hidden="true">
                  {initials(recipient.name)}
                </span>
                <span className={styles.activityWho}>
                  <strong>{recipient.name}</strong>
                  <span>{recipient.company}</span>
                </span>
                <span className={`${styles.activityStatus} ${statusClass[recipient.status]}`}>
                  {recipient.label}
                </span>
              </li>
            ))}
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
              </li>
            ))}
          </ul>
        </article>
      </div>
    </div>
  );
}
