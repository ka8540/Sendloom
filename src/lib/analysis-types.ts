import type { AnalysisPage, MetricComparison } from "@/lib/analysis";

export type AnalysisMetric = {
  key: string;
  label: string;
  value: number;
  format: "number" | "percent";
  detail: string;
  info: string;
  comparison?: MetricComparison;
  tone: "green" | "blue" | "purple" | "orange" | "red";
  icon: "send" | "open" | "reply" | "click" | "attention" | "sequence" | "play" | "trend" | "check" | "retry" | "failure" | "pause" | "sender" | "capacity";
  unavailable?: boolean;
};

export type AnalysisTrendPoint = {
  date: string;
  label: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
};

export type AnalysisRankedItem = {
  name: string;
  sent: number;
  replies: number;
  replyRate: number;
  change?: number | null;
  detail?: string;
};

export type AnalysisBreakdownItem = {
  name: string;
  value: number;
  percent: number;
  tone?: AnalysisMetric["tone"];
};

export type AnalysisJourneyStage = {
  name: string;
  value: number;
  conversion: number | null;
  unavailable?: boolean;
};

export type AnalysisHeatmapCell = {
  day: string;
  dayIndex: number;
  block: string;
  blockIndex: number;
  sent: number;
  replies: number;
  replyRate: number;
  intensity: number;
  meetsMinimum: boolean;
};

export type AnalysisSequencePoint = AnalysisRankedItem & {
  targeted: number;
  status: string;
};

export type AnalysisTemplateItem = {
  name: string;
  sent: number;
  replies: number;
  replyRate: number;
  usageCount: number;
};

export type AnalysisOperationalPoint = {
  date: string;
  label: string;
  retries: number;
  pauses: number;
  resumed: number;
};

export type AnalysisAttentionItem = {
  title: string;
  detail: string;
  action: string;
  tone: "orange" | "purple" | "red";
};

export type AnalysisSenderItem = {
  name: string;
  email: string;
  sent: number;
  opened: number;
  replied: number;
  replyRate: number;
  capacity: {
    limit: number;
    used: number;
    remaining: number;
    percentUsed: number;
    resetAt: string | null;
    available: boolean;
  };
  health: "Reconnect needed" | "Synced" | "Pacing wait" | "Healthy";
};

export type AnalysisSenderChange = {
  title: string;
  detail: string;
  at: string;
  tone: "green" | "blue" | "purple" | "orange";
};

type AnalysisResponseBase = {
  page: AnalysisPage;
  range: {
    from: string;
    to: string;
    label: string;
    days: number;
  };
  generatedAt: string;
  hasData: boolean;
  metrics: AnalysisMetric[];
};

export type AnalysisOverviewResponse = AnalysisResponseBase & {
  page: "overview";
  trends: AnalysisTrendPoint[];
  outcomeMix: AnalysisBreakdownItem[];
  journey: AnalysisJourneyStage[];
  bestDays: Array<{ name: string; sent: number; replies: number; replyRate: number; meetsMinimum: boolean }>;
  topMovers: AnalysisRankedItem[];
};

export type AnalysisEngagementResponse = AnalysisResponseBase & {
  page: "engagement";
  trends: AnalysisTrendPoint[];
  clickAvailable: boolean;
  journey: AnalysisJourneyStage[];
  heatmap: AnalysisHeatmapCell[];
  scheduleTypes: AnalysisBreakdownItem[];
};

export type AnalysisSequencesResponse = AnalysisResponseBase & {
  page: "sequences";
  topSequences: AnalysisRankedItem[];
  sequencePoints: AnalysisSequencePoint[];
  templates: AnalysisTemplateItem[];
  statusMix: AnalysisBreakdownItem[];
  standoutRuns: AnalysisRankedItem[];
};

export type AnalysisReliabilityResponse = AnalysisResponseBase & {
  page: "reliability";
  failureReasons: AnalysisBreakdownItem[];
  runStates: AnalysisBreakdownItem[];
  operationalEvents: AnalysisOperationalPoint[];
  pacing: {
    waitingRecipients: number;
    sendWindowPauses: number;
    nextRecoveryAt: string | null;
  };
  attention: AnalysisAttentionItem[];
};

export type AnalysisSendersResponse = AnalysisResponseBase & {
  page: "senders";
  senders: AnalysisSenderItem[];
  health: AnalysisBreakdownItem[];
  recentChanges: AnalysisSenderChange[];
  capacityLimit: number;
};

export type AnalysisResponse =
  | AnalysisOverviewResponse
  | AnalysisEngagementResponse
  | AnalysisSequencesResponse
  | AnalysisReliabilityResponse
  | AnalysisSendersResponse;
