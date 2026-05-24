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

export type SequenceRowData = {
  id: string;
  href: Route;
  name: string;
  statusLabel: string;
  statusTone: SequenceStatusTone;
  summary: string;
  progressPercent: number;
  progressLabel: string;
  deliveryLabel: string;
  deliveryDetail: string;
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
