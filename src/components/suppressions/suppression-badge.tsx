import clsx from "clsx";

import type { SuppressionReason } from "@/components/suppressions/types";

import styles from "./suppressions.module.css";

// Delivery failures read as "Failed" (with their cause); unsubscribe and
// manual/compliance exclusions keep their own labels — an unsubscribed
// recipient is suppressed but did NOT fail.
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  UNSUBSCRIBED: "Unsubscribed",
  HARD_BOUNCE: "Failed · hard bounce",
  COMPLAINT: "Complaint",
  INVALID_EMAIL: "Failed · invalid email",
  MANUAL_BLOCK: "Manual block"
};

const REASON_TONES: Record<SuppressionReason, string> = {
  UNSUBSCRIBED: styles.badgeAmber,
  HARD_BOUNCE: styles.badgeRed,
  COMPLAINT: styles.badgeRose,
  INVALID_EMAIL: styles.badgeBlue,
  MANUAL_BLOCK: styles.badgeNeutral
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  "unsubscribe-link": "Unsubscribe link",
  "provider-webhook": "Provider webhook",
  "gmail-dsn": "Gmail delivery notification"
};

export function formatSuppressionSource(source: string) {
  const normalized = source.trim().toLowerCase();
  if (SOURCE_LABELS[normalized]) {
    return SOURCE_LABELS[normalized];
  }

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function SuppressionReasonBadge({ reason }: { reason: SuppressionReason }) {
  return <span className={clsx(styles.badge, REASON_TONES[reason])}>{SUPPRESSION_REASON_LABELS[reason]}</span>;
}

export function SuppressionSourceBadge({ source }: { source: string }) {
  return <span className={clsx(styles.badge, styles.sourceBadge)}>{formatSuppressionSource(source)}</span>;
}
