"use client";

// Presentational pieces shared by the Discover list page (/prospects) and the
// Discover detail page (/prospects/[searchId]). Splitting these out lets both
// route components reuse the same badges, empty/disabled states, and quota chip
// without duplicating markup. All styling comes from the shared CSS module.

import type { ReactNode } from "react";
import { Ban } from "lucide-react";

import {
  PROSPECT_FINDER_UNAVAILABLE_BODY,
  PROSPECT_FINDER_UNAVAILABLE_TITLE,
  formatQuotaRemaining,
  type Badge,
  type BadgeTone
} from "@/components/prospects/prospect-view";
import type { DiscoverQuota } from "@/components/prospects/prospect-graphql";
import styles from "@/components/prospects/prospects-dashboard.module.css";

// ---------------------------------------------------------------------------
// Shared types + constants
// ---------------------------------------------------------------------------

export type CreateForm = {
  companyName: string;
  jobTitles: string;
  locations: string;
};

export type ActionNotice = {
  message: string;
  href?: string;
  label?: string;
};

export type ReviewIntent = "download" | "import";

export const EMPTY_FORM: CreateForm = { companyName: "", jobTitles: "", locations: "" };

export const EMAIL_PATTERN_OPTIONS = [
  "first",
  "last",
  "firstlast",
  "first.last",
  "first_last",
  "flast",
  "f.last",
  "f_last",
  "firstl",
  "first.l",
  "lastf",
  "last.first"
];

const TONE_CLASS: Record<BadgeTone, string> = {
  verified: styles.toneVerified,
  inferred: styles.toneInferred,
  neutral: styles.toneNeutral,
  warning: styles.toneWarning,
  muted: styles.toneMuted,
  blocked: styles.toneBlocked
};

export function BadgePill({ badge }: { badge: Badge }) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[badge.tone]}`} title={badge.hint}>
      {badge.label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  compact = false,
  action,
  tourTarget
}: {
  icon: ReactNode;
  title: string;
  body: string;
  compact?: boolean;
  action?: ReactNode;
  tourTarget?: string;
}) {
  return (
    <div
      className={`${styles.emptyState} ${compact ? styles.emptyStateCompact : "card"}`}
      data-discover-tour={tourTarget}
    >
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

export function DisabledState() {
  return (
    <div className={`card ${styles.disabledCard}`}>
      <span className={styles.disabledIcon} aria-hidden="true">
        <Ban />
      </span>
      <h2 className={styles.emptyTitle}>{PROSPECT_FINDER_UNAVAILABLE_TITLE}</h2>
      <p className={styles.emptyBody}>{PROSPECT_FINDER_UNAVAILABLE_BODY}</p>
    </div>
  );
}

/** Compact remaining-count chip near the New search action / detail header. */
export function QuotaIndicator({ quota }: { quota: DiscoverQuota | null }) {
  if (!quota) {
    return null;
  }
  if (quota.unlimited) {
    return (
      <span
        className={`${styles.quotaIndicator} ${styles.quotaIndicatorUnlimited}`}
        data-discover-tour="quota"
        data-discover-quota="unlimited"
      >
        Unlimited Discover access
      </span>
    );
  }
  return (
    <span className={styles.quotaIndicator} data-discover-tour="quota" data-discover-quota="limited">
      {formatQuotaRemaining(quota)}
    </span>
  );
}
