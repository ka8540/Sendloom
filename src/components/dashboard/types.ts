import type { Route } from "next";

export type DashboardTrend = {
  direction: "up" | "down" | "flat";
  label: string;
};

export type SequenceStatusTone =
  | "running"
  | "completed"
  | "failed"
  | "scheduled"
  | "paused"
  | "draft";

export type SequenceHealthTone = "clean" | "issues" | "skipped" | "syncing" | "idle";

// How the sequence was scheduled. Mirrors Campaign.scheduleType in the DB
// ("immediate" | "once" | "recurring"); legacy/missing values normalize to
// "immediate" via normalizeScheduleType so the filter never receives an
// unexpected value.
export type SequenceScheduleType = "immediate" | "once" | "recurring";

export type SequenceMetric = {
  key: string;
  label: string;
  value: string;
  tone?: "issues";
};

export type SequenceRowData = {
  id: string;
  href: Route;
  name: string;
  statusLabel: string;
  statusTone: SequenceStatusTone;
  // Full "list · template · sender" string — kept for search matching and as the
  // accessible label behind the truncated metadata chips.
  summary: string;
  meta: {
    list: string;
    template: string;
    sender: string;
  };
  scheduleType: SequenceScheduleType;
  progressPercent: number;
  metrics: SequenceMetric[];
  health: {
    label: string;
    tone: SequenceHealthTone;
    hint?: string;
    ariaLabel?: string;
  };
  lastActivityLabel: string;
  lastActivityAt: string;
  updatedAtValue: number;
  isValidated: boolean;
  needsAttention: boolean;
  canRelaunch: boolean;
  isActiveRun: boolean;
  isPausedRun: boolean;
  dailyLimitBlock: {
    resumesAt: string | null;
  } | null;
};

// Precise activity type for the newer Discover/Finder events. Drives icon
// selection deterministically (instead of fuzzy title/description matching) so
// each action gets its own task-appropriate glyph. Internal only — never
// rendered to the user. Existing run/import/template/suppression rows leave this
// undefined and keep their original keyword-based icon behavior.
export type ActivityEventType =
  | "discover_search_created"
  | "discover_search_ready"
  | "discover_search_failed"
  | "discover_people_added"
  | "discover_results_exported"
  | "finder_email_found"
  | "finder_domain_search"
  | "sequence_run_skipped"
  | "delivery_failure_recorded";

export type ActivityItem = {
  id: string;
  href: Route;
  title: string;
  description: string;
  timeLabel: string;
  timeValue: string;
  kind: "run" | "import" | "template" | "suppression" | "discover" | "finder";
  tone: "accent" | "success" | "warning" | "muted";
  eventType?: ActivityEventType;
};
