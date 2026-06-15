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

export type SequenceHealthTone = "clean" | "issues" | "syncing" | "idle";

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

export type ActivityItem = {
  id: string;
  href: Route;
  title: string;
  description: string;
  timeLabel: string;
  timeValue: string;
  kind: "run" | "import" | "template" | "suppression";
  tone: "accent" | "success" | "warning" | "muted";
};
