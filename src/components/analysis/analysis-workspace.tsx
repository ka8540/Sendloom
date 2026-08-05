"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleCheck,
  CirclePause,
  CircleUserRound,
  Download,
  Gauge,
  Mail,
  MailX,
  MousePointer2,
  PlayCircle,
  RefreshCw,
  Reply,
  Send,
  TrendingUp
} from "lucide-react";

import type { AnalysisPage, AnalysisPresetDays } from "@/lib/analysis";
import {
  ANALYSIS_PRESET_DAYS,
  analysisPresetLabel,
  formatAnalysisRangeLabel,
  normalizeAnalysisDateRange,
  toUtcDateKey
} from "@/lib/analysis";
import { buildAnalysisCsv } from "@/lib/analysis-export";
import type {
  AnalysisJourneyStage,
  AnalysisMetric,
  AnalysisResponse,
  AnalysisOverviewResponse,
  AnalysisEngagementResponse,
  AnalysisSequencesResponse,
  AnalysisReliabilityResponse,
  AnalysisSendersResponse
} from "@/lib/analysis-types";
import {
  AttentionCard,
  BestDaysCard,
  DonutCard,
  FailureReasonsCard,
  HeatmapCard,
  HorizontalRateCard,
  JourneyCard,
  OperationalEventsCard,
  OutcomeMixCard,
  PacingCard,
  RankedListCard,
  ScheduleTypeCard,
  SenderCapacityCard,
  SenderChangesCard,
  SenderHealthCard,
  SenderReplyRateCard,
  SenderVolumeCard,
  SequenceScatterCard,
  TemplatePerformanceCard,
  TrendsCard
} from "@/components/analysis/analysis-charts";
import { AnalysisInfo, formatAnalysisNumber } from "@/components/analysis/analysis-ui";

import styles from "./analysis.module.css";

const PAGE_META: Record<AnalysisPage, { label: string; subtitle: string; href: Route }> = {
  overview: { label: "Summary", subtitle: "A quick view of outreach performance.", href: "/analysis" as Route },
  engagement: { label: "Engagement", subtitle: "Track engagement across your outreach.", href: "/analysis/engagement" as Route },
  sequences: { label: "Sequences", subtitle: "Compare sequence and template performance.", href: "/analysis/sequences" as Route },
  reliability: { label: "Reliability", subtitle: "Understand failures, pauses, and sending health.", href: "/analysis/reliability" as Route },
  senders: { label: "Senders", subtitle: "Compare connected Gmail senders and capacity.", href: "/analysis/senders" as Route }
};

const METRIC_ICONS: Record<AnalysisMetric["icon"], ComponentType<{ "aria-hidden"?: boolean }>> = {
  send: Send,
  open: Mail,
  unopened: MailX,
  reply: Reply,
  click: MousePointer2,
  attention: AlertTriangle,
  sequence: BarChart3,
  play: PlayCircle,
  trend: TrendingUp,
  check: CircleCheck,
  retry: RefreshCw,
  failure: AlertTriangle,
  pause: CirclePause,
  sender: CircleUserRound,
  capacity: Gauge
};

const PRESET_DESCRIPTIONS: Record<AnalysisPresetDays, string> = {
  7: "Recent outreach performance",
  30: "Monthly outreach performance"
};

function presetRange(days: AnalysisPresetDays) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - (days - 1) * 86_400_000);
  return { from: toUtcDateKey(start), to: toUtcDateKey(today), start, end: today };
}

function DateRangeControl({
  days,
  onChange
}: {
  days: AnalysisPresetDays;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      options[(next + options.length) % options.length]?.focus();
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
  }, [open]);

  const choosePreset = (nextDays: AnalysisPresetDays) => {
    const next = presetRange(nextDays);
    onChange({ from: next.from, to: next.to });
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={styles.rangeShell} ref={shellRef}>
      <button
        ref={triggerRef}
        className={styles.rangeTrigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Analysis date range: ${analysisPresetLabel(days)}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CalendarDays aria-hidden="true" />
        <span>{analysisPresetLabel(days)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.rangeMenu} role="menu" aria-label="Analysis date range" ref={menuRef}>
          {ANALYSIS_PRESET_DAYS.map((preset) => {
            const span = presetRange(preset);
            return (
              <button
                key={preset}
                type="button"
                role="menuitemradio"
                aria-checked={preset === days}
                className={styles.rangeOption}
                onClick={() => choosePreset(preset)}
                title={`${analysisPresetLabel(preset)} · ${formatAnalysisRangeLabel(span.start, span.end)}`}
              >
                <span>
                  <strong>{analysisPresetLabel(preset)}</strong>
                  <small>{PRESET_DESCRIPTIONS[preset]}</small>
                </span>
                {preset === days ? <Check aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function buildJourneyInsight(stages: AnalysisJourneyStage[]) {
  const value = (name: string) => stages.find((stage) => stage.name === name)?.value;
  const sent = value("Sent");
  const opened = value("Opened");
  const unopened = value("Unopened");
  const replied = value("Replied");
  if (sent === undefined || !sent || opened === undefined || unopened === undefined || replied === undefined) {
    return undefined;
  }
  return `${sent.toLocaleString()} confirmed sends led to ${opened.toLocaleString()} opens, ${unopened.toLocaleString()} unopened, and ${replied.toLocaleString()} replies.`;
}

function MetricStrip({ data }: { data: AnalysisResponse }) {
  return (
    <div className={styles.metricStripShell}>
      <section className={styles.metricStrip} aria-label="Analysis summary metrics">
        {data.metrics.map((item) => {
          const Icon = METRIC_ICONS[item.icon];
          return (
            <article key={item.key} data-tone={item.tone} className={item.unavailable ? styles.metricUnavailable : ""}>
              <span className={styles.metricIcon}><Icon aria-hidden={true} /></span>
              <div className={styles.metricCopy}>
                <div className={styles.metricLabel}>
                  <span>{item.label}</span>
                  <AnalysisInfo label={`About ${item.label}`} title={item.label}>{item.info}</AnalysisInfo>
                </div>
                <strong>{item.unavailable ? "—" : item.format === "percent" ? `${item.value.toFixed(1)}%` : formatAnalysisNumber(item.value)}</strong>
                <small>{item.detail}</small>
                {item.comparison ? (
                  <em data-direction={item.comparison.direction}>
                    <ComparisonText label={item.comparison.label} />
                  </em>
                ) : null}
              </div>
              <ChartNoAxesCombined className={styles.metricTrendIcon} aria-hidden="true" />
            </article>
          );
        })}
      </section>
    </div>
  );
}

function ComparisonText({ label }: { label: string }) {
  const index = label.indexOf(" vs ");
  if (index === -1) return <span className={styles.keepTogether}>{label}</span>;
  return (
    <>
      <span className={styles.keepTogether}>{label.slice(0, index)}</span>{" "}
      <span className={styles.keepTogether}>{label.slice(index + 1)}</span>
    </>
  );
}

function OverviewVisuals({ data }: { data: AnalysisOverviewResponse }) {
  return (
    <>
      <div className={styles.twoColumnWideLeft}>
        <TrendsCard title="Outreach activity" data={data.trends} />
        <OutcomeMixCard data={data.outcomeMix} totalSent={data.metrics[0]?.value ?? 0} rangeLabel={data.range.label} />
      </div>
      <div className={styles.threeColumn}>
        <JourneyCard title="Journey funnel" stages={data.journey} info="Targeted recipients through confirmed sends, tracked opens, and unique matched replies." />
        <BestDaysCard data={data.bestDays} />
        <RankedListCard title="Top movers" data={data.topMovers} info="Qualified sequences ranked by reply-rate change against the preceding equal-length period; without a prior sample, unique replies break ties." />
      </div>
    </>
  );
}

function EngagementVisuals({ data }: { data: AnalysisEngagementResponse }) {
  return (
    <>
      <div className={styles.twoColumn}>
        <TrendsCard title="Engagement trends" data={data.trends} />
        <TrendsCard title="Rate trends" data={data.trends} rate includeClicks={data.clickAvailable} />
      </div>
      <div className={styles.engagementBottom}>
        <JourneyCard
          title="Engagement journey"
          stages={data.journey}
          info="Targeted recipients through confirmed sends, unique tracked opens, sends without a tracked open, and unique matched replies."
          insight={buildJourneyInsight(data.journey)}
        />
        <HeatmapCard data={data.heatmap} />
        <ScheduleTypeCard data={data.scheduleTypes} />
      </div>
    </>
  );
}

function topSequencesInsight(items: AnalysisSequencesResponse["topSequences"]) {
  if (!items.length) return undefined;
  const replied = items.filter((item) => item.replies > 0);
  if (!replied.length) return "No sequence received a matched reply in this period.";
  const leader = replied[0];
  return `${leader.name} leads with a ${leader.replyRate.toFixed(1)}% reply rate, and ${
    replied.length === 1 ? "it is the only sequence" : `${replied.length} sequences`
  } with at least one reply.`;
}

function sequenceVolumeInsight(points: AnalysisSequencesResponse["sequencePoints"]) {
  const active = points.filter((point) => point.sent > 0);
  if (!active.length) return undefined;
  const replied = active.filter((point) => point.replies > 0);
  if (!replied.length) return "No sequence recorded a matched reply during this period.";
  const bestRate = [...replied].sort((a, b) => b.replyRate - a.replyRate)[0];
  const highestVolume = [...active].sort((a, b) => b.sent - a.sent)[0];
  if (bestRate.name === highestVolume.name) {
    return `${bestRate.name} led on both sending volume and reply rate at ${bestRate.replyRate.toFixed(1)}%.`;
  }
  return `${bestRate.name} had the strongest reply rate at ${bestRate.replyRate.toFixed(1)}%, while ${
    highestVolume.name
  } sent the most at ${highestVolume.sent.toLocaleString()} confirmed sends.`;
}

function templateInsight(items: AnalysisSequencesResponse["templates"]) {
  if (!items.length) return undefined;
  const leader = [...items].sort((a, b) => b.replyRate - a.replyRate)[0];
  return `${leader.name} has the highest reply rate at ${leader.replyRate.toFixed(1)}% across ${
    leader.usageCount
  } sequence${leader.usageCount === 1 ? "" : "s"}.`;
}

function statusMixInsight(items: AnalysisSequencesResponse["statusMix"]) {
  const positive = items.filter((item) => item.value > 0);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  if (!total) return undefined;
  const [leader, runnerUp] = [...positive].sort((a, b) => b.value - a.value);
  const lead = `${leader.value.toLocaleString()} of ${total.toLocaleString()} selected run${
    total === 1 ? " is" : "s are"
  } ${leader.name.toLowerCase()}`;
  return runnerUp
    ? `${lead}, while ${runnerUp.value.toLocaleString()} ${runnerUp.value === 1 ? "is" : "are"} ${runnerUp.name.toLowerCase()}.`
    : `${lead}.`;
}

function standoutRunsInsight(items: AnalysisSequencesResponse["standoutRuns"]) {
  if (!items.length) return undefined;
  const replied = items.filter((item) => item.replies > 0).length;
  if (!replied) return "None of the listed runs recorded a matched reply.";
  return `${replied} of the ${items.length} listed run${items.length === 1 ? "" : "s"} received at least one reply.`;
}

function SequencesVisuals({ data }: { data: AnalysisSequencesResponse }) {
  return (
    <>
      <div className={styles.twoColumn}>
        <HorizontalRateCard
          title="Top sequences by reply rate"
          data={data.topSequences}
          info="Sequences are ranked by the percentage of confirmed recipients who sent at least one matched reply. Sequences with fewer than 20 confirmed sends are excluded to prevent misleading results."
          helper="Highest reply rates among sequences with meaningful send volume."
          insight={topSequencesInsight(data.topSequences)}
        />
        <SequenceScatterCard
          data={data.sequencePoints}
          helper="Compare sending volume with recipient response across sequences."
          insight={sequenceVolumeInsight(data.sequencePoints)}
        />
      </div>
      <div className={styles.sequenceBottom}>
        <TemplatePerformanceCard
          data={data.templates}
          helper="See which saved templates generated the strongest reply rates."
          insight={templateInsight(data.templates)}
        />
        <DonutCard
          title="Sequence status mix"
          data={data.statusMix}
          centerValue={data.statusMix.reduce((sum, item) => sum + item.value, 0)}
          centerLabel="Selected runs"
          info="This chart shows the current status distribution of the sequence runs included in the selected date range. Waiting for Slot is grouped under Waiting."
          helper="Distribution of selected runs by their current status."
          insight={statusMixInsight(data.statusMix)}
        />
        <RankedListCard
          title="Standout runs"
          data={data.standoutRuns}
          info="These runs are ranked by reply rate and confirmed sending volume during the selected period. Runs need at least 20 confirmed sends to appear."
          helper="Runs with the strongest reply performance in the selected period."
          insight={standoutRunsInsight(data.standoutRuns)}
        />
      </div>
    </>
  );
}

function ReliabilityVisuals({ data }: { data: AnalysisReliabilityResponse }) {
  return (
    <>
      <div className={styles.twoColumnWideLeft}>
        <FailureReasonsCard data={data.failureReasons} />
        <DonutCard title="Run state distribution" data={data.runStates} centerValue={data.runStates.reduce((sum, item) => sum + item.value, 0)} centerLabel="Selected runs" info="Real states for campaign runs active in the selected UTC range." />
      </div>
      <div className={styles.reliabilityBottom}>
        <OperationalEventsCard data={data.operationalEvents} />
        <PacingCard waiting={data.pacing.waitingRecipients} pauses={data.pacing.sendWindowPauses} nextRecoveryAt={data.pacing.nextRecoveryAt} />
        <AttentionCard data={data.attention} />
      </div>
    </>
  );
}

function SendersVisuals({ data }: { data: AnalysisSendersResponse }) {
  return (
    <>
      <div className={styles.twoColumnWideLeft}>
        <SenderCapacityCard data={data.senders} />
        <SenderReplyRateCard data={data.senders} />
      </div>
      <div className={styles.sendersBottom}>
        <SenderVolumeCard data={data.senders} />
        <SenderHealthCard data={data.health} />
        <SenderChangesCard data={data.recentChanges} />
      </div>
    </>
  );
}

function LoadingWorkspace() {
  return (
    <div className={styles.loadingLayout} role="status" aria-label="Loading Analysis">
      <div className={styles.loadingMetrics}>{[0, 1, 2, 3].map((item) => <i key={item} />)}</div>
      <div className={styles.loadingCharts}><i /><i /></div>
      <div className={styles.loadingChartsSmall}><i /><i /><i /></div>
    </div>
  );
}

export function AnalysisWorkspace({ page }: { page: AnalysisPage }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = useMemo(
    () => normalizeAnalysisDateRange({ from: searchParams.get("from"), to: searchParams.get("to") }),
    [searchParams]
  );
  const [range, setRange] = useState({ from: initial.from, to: initial.to, days: initial.days as AnalysisPresetDays });
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const normalized = normalizeAnalysisDateRange({ from: searchParams.get("from"), to: searchParams.get("to") });
    setRange((current) =>
      current.from === normalized.from && current.to === normalized.to
        ? current
        : { from: normalized.from, to: normalized.to, days: normalized.days as AnalysisPresetDays }
    );
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/analysis/${page}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const payload = (await response.json()) as AnalysisResponse | { error?: string };
        if (!response.ok || !("page" in payload)) {
          throw new Error("error" in payload && payload.error ? payload.error : "Analysis could not be loaded.");
        }
        setData(payload);
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setError(fetchError instanceof Error ? fetchError.message : "Analysis could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, range.from, range.to, retryKey]);

  const updateRange = useCallback(
    (next: { from: string; to: string }) => {
      const normalized = normalizeAnalysisDateRange(next);
      setRange({ from: normalized.from, to: normalized.to, days: normalized.days as AnalysisPresetDays });
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", normalized.from);
      params.set("to", normalized.to);
      router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const exportCsv = () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const blob = new Blob([buildAnalysisCsv(data)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sendloom-analysis-${data.page}-${data.range.from}-to-${data.range.to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const visuals = data?.page === "overview"
    ? <OverviewVisuals data={data} />
    : data?.page === "engagement"
      ? <EngagementVisuals data={data} />
      : data?.page === "sequences"
        ? <SequencesVisuals data={data} />
        : data?.page === "reliability"
          ? <ReliabilityVisuals data={data} />
          : data?.page === "senders"
            ? <SendersVisuals data={data} />
            : null;

  return (
    <div className={styles.workspace} aria-busy={loading}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Analysis</h1>
          <p>{PAGE_META[page].subtitle}</p>
        </div>
        <div className={styles.headerControls}>
          <DateRangeControl days={range.days} onChange={updateRange} />
          <button
            className={styles.toolbarButton}
            type="button"
            onClick={exportCsv}
            disabled={!data || loading || exporting}
            aria-label="Export current Analysis page as CSV"
          >
            {exporting ? <RefreshCw className={styles.toolbarSpinner} aria-hidden="true" /> : <Download aria-hidden="true" />}
            <span>{exporting ? "Exporting…" : "Export"}</span>
          </button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Analysis pages">
        {Object.entries(PAGE_META).map(([key, item]) => (
          <Link
            key={key}
            href={{ pathname: item.href, query: { from: range.from, to: range.to } }}
            className={page === key ? styles.activeTab : ""}
            aria-current={page === key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {error && !data ? (
        <div className={styles.errorState} role="alert">
          <AlertTriangle aria-hidden="true" />
          <div><strong>Analysis couldn’t load.</strong><p>{error}</p></div>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Try again</button>
        </div>
      ) : null}

      {!data && loading ? <LoadingWorkspace /> : null}

      {data ? (
        <>
          <MetricStrip data={data} />
          {error ? (
            <div className={styles.inlineError} role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
            </div>
          ) : null}
          {loading ? <div className={styles.refreshBar} role="status"><span />Updating Analysis…</div> : null}
          <div className={styles.visuals}>{visuals}</div>
        </>
      ) : null}

      <footer className={styles.footerNote}>
        <AnalysisInfo label="About Analysis freshness">Metrics use bounded, user-scoped stored data. Sender capacity is a current rolling 24-hour value.</AnalysisInfo>
        <span>Analytics are calculated in UTC and may not reflect real-time data.</span>
      </footer>
    </div>
  );
}
