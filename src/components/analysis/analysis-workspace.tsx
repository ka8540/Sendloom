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
  ChevronDown,
  CircleCheck,
  CirclePause,
  CircleUserRound,
  Download,
  Gauge,
  Mail,
  MousePointer2,
  PlayCircle,
  RefreshCw,
  Reply,
  Send,
  TrendingUp
} from "lucide-react";

import type { AnalysisPage } from "@/lib/analysis";
import { normalizeAnalysisDateRange, toUtcDateKey } from "@/lib/analysis";
import { buildAnalysisCsv } from "@/lib/analysis-export";
import type {
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

function presetRange(days: number) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    from: toUtcDateKey(new Date(today.getTime() - (days - 1) * 86_400_000)),
    to: toUtcDateKey(today)
  };
}

function DateRangeControl({
  from,
  to,
  label,
  onChange
}: {
  from: string;
  to: string;
  label: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomFrom(from);
    setCustomTo(to);
  }, [from, to]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choosePreset = (days: number) => {
    onChange(presetRange(days));
    setOpen(false);
  };
  const customValid = customFrom <= customTo;

  return (
    <div className={styles.rangeShell} ref={shellRef}>
      <button
        className={styles.controlButton}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Analysis date range: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.rangePopover} role="dialog" aria-label="Choose Analysis date range">
          <strong>Date range</strong>
          <div className={styles.presetGrid}>
            {[7, 30, 90].map((days) => (
              <button type="button" key={days} onClick={() => choosePreset(days)}>
                Last {days} days
              </button>
            ))}
          </div>
          <div className={styles.customRange}>
            <span>Custom range</span>
            <label>
              <span>From</span>
              <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} />
            </label>
            <button
              type="button"
              className={styles.applyRange}
              disabled={!customFrom || !customTo || !customValid}
              onClick={() => {
                onChange({ from: customFrom, to: customTo });
                setOpen(false);
              }}
            >
              Apply range
            </button>
          </div>
          <small>Up to 366 calendar days · UTC</small>
        </div>
      ) : null}
    </div>
  );
}

function MetricStrip({ data }: { data: AnalysisResponse }) {
  return (
    <section className={styles.metricStrip} aria-label="Analysis summary metrics">
      {data.metrics.map((item) => {
        const Icon = METRIC_ICONS[item.icon];
        return (
          <article key={item.key} data-tone={item.tone} className={item.unavailable ? styles.metricUnavailable : ""}>
            <span className={styles.metricIcon}><Icon aria-hidden={true} /></span>
            <div className={styles.metricCopy}>
              <div className={styles.metricLabel}>
                <span>{item.label}</span>
                <AnalysisInfo label={`About ${item.label}`}>{item.info}</AnalysisInfo>
              </div>
              <strong>{item.unavailable ? "—" : item.format === "percent" ? `${item.value.toFixed(1)}%` : formatAnalysisNumber(item.value)}</strong>
              <small>{item.detail}</small>
              {item.comparison ? <em data-direction={item.comparison.direction}>{item.comparison.label}</em> : null}
            </div>
            <ChartNoAxesCombined className={styles.metricTrendIcon} aria-hidden="true" />
          </article>
        );
      })}
    </section>
  );
}

function OverviewVisuals({ data }: { data: AnalysisOverviewResponse }) {
  return (
    <>
      <div className={styles.twoColumnWideLeft}>
        <TrendsCard title="Outreach activity" data={data.trends} />
        <DonutCard title="Outcome mix" data={data.outcomeMix} centerValue={data.metrics[0]?.value ?? 0} centerLabel="Total sent" info="Mutually exclusive recipient outcomes: replied, clicked, opened, bounced, then other." />
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
        <JourneyCard title="Engagement journey" stages={data.journey} info="Targeted recipients through sent, unique tracked-open, unique tracked-click, and unique matched-reply stages." />
        <HeatmapCard data={data.heatmap} />
        <ScheduleTypeCard data={data.scheduleTypes} />
      </div>
    </>
  );
}

function SequencesVisuals({ data }: { data: AnalysisSequencesResponse }) {
  return (
    <>
      <div className={styles.twoColumn}>
        <HorizontalRateCard title="Top sequences by reply rate" data={data.topSequences} info="Unique matched replies divided by confirmed sends. Sequences require at least 20 confirmed sends." />
        <SequenceScatterCard data={data.sequencePoints} />
      </div>
      <div className={styles.sequenceBottom}>
        <TemplatePerformanceCard data={data.templates} />
        <DonutCard title="Sequence status mix" data={data.statusMix} centerValue={data.statusMix.reduce((sum, item) => sum + item.value, 0)} centerLabel="Selected runs" info="Real campaign-run states with Waiting for Slot normalized to Waiting." />
        <RankedListCard title="Standout runs" data={data.standoutRuns} info="Selected-period runs with at least 20 confirmed sends, ranked by unique-recipient reply rate." />
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
  const [range, setRange] = useState({ from: initial.from, to: initial.to, label: initial.label });
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const normalized = normalizeAnalysisDateRange({ from: searchParams.get("from"), to: searchParams.get("to") });
    setRange((current) =>
      current.from === normalized.from && current.to === normalized.to
        ? current
        : { from: normalized.from, to: normalized.to, label: normalized.label }
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
      setRange({ from: normalized.from, to: normalized.to, label: normalized.label });
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", normalized.from);
      params.set("to", normalized.to);
      router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const exportCsv = () => {
    if (!data) return;
    const blob = new Blob([buildAnalysisCsv(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sendloom-analysis-${data.page}-${data.range.from}-to-${data.range.to}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
          <DateRangeControl from={range.from} to={range.to} label={range.label} onChange={updateRange} />
          <button className={styles.controlButton} type="button" onClick={exportCsv} disabled={!data || loading} aria-label="Export current Analysis page as CSV">
            <Download aria-hidden="true" />
            <span>Export</span>
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
