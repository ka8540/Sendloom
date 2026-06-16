"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Gauge,
  Layers,
  type LucideIcon,
  MailOpen,
  Minus,
  Radar,
  Reply,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  Users
} from "lucide-react";

import { formatCompactNumber } from "@/components/dashboard/formatters";
import {
  ANALYTICS_WINDOWS,
  ANALYTICS_WINDOW_LABELS,
  ANALYTICS_WINDOW_SHORT,
  type AnalyticsKpi,
  type AnalyticsWindow,
  type OverviewAnalytics
} from "@/components/dashboard/analytics-types";
import {
  ActivityHeatmap,
  AnimatedNumber,
  HealthDonut,
  TimelineChart,
  toneColor,
  useReducedMotion
} from "@/components/dashboard/analytics-charts";
import styles from "./analytics.module.css";

const KPI_ICONS: Record<string, LucideIcon> = {
  audience: Users,
  delivered: Send,
  opened: MailOpen,
  replied: Reply,
  attention: AlertTriangle,
  completion: Gauge
};

const trendIcons = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus
} as const;

type Cache = Partial<Record<AnalyticsWindow, OverviewAnalytics>>;

export function AnalyticsCommandCenter({
  initialData,
  initialWindow
}: {
  initialData: OverviewAnalytics;
  initialWindow: AnalyticsWindow;
}) {
  const reducedMotion = useReducedMotion();
  const [window, setWindow] = useState<AnalyticsWindow>(initialWindow);
  const [cache, setCache] = useState<Cache>({ [initialWindow]: initialData });
  const [shown, setShown] = useState<OverviewAnalytics>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const cached = cache[window];
  useEffect(() => {
    if (cached) {
      setShown(cached);
    }
  }, [cached]);

  const selectWindow = useCallback(
    async (next: AnalyticsWindow) => {
      if (next === window) {
        return;
      }
      setWindow(next);
      setError(null);
      if (cache[next]) {
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      try {
        const response = await fetch(`/api/overview/analytics?window=${next}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = (await response.json()) as OverviewAnalytics;
        setCache((prev) => ({ ...prev, [next]: payload }));
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setError("Couldn't refresh analytics. Try again.");
        }
      } finally {
        setLoading(false);
      }
    },
    [window, cache]
  );

  const animate = !reducedMotion;
  let panelIndex = 0;
  const nextPanelStyle = () => ({ "--reveal-index": panelIndex++ } as CSSProperties);

  return (
    <section className={styles.analytics} aria-label="Performance intelligence">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowPulse} aria-hidden="true" />
            Performance intelligence
          </span>
          <h2 className={styles.title}>Analytics command center</h2>
          <p className={styles.subtitle}>
            A live read on deliverability, engagement, sender capacity, and the issues worth acting on — across your
            outreach.
          </p>
        </div>

        <div className={styles.headerControls}>
          <div
            className={styles.segmented}
            role="group"
            aria-label="Analytics time window"
            data-loading={loading ? "true" : undefined}
          >
            {ANALYTICS_WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.segment}
                data-active={option === window ? "true" : undefined}
                aria-pressed={option === window}
                onClick={() => selectWindow(option)}
                title={ANALYTICS_WINDOW_LABELS[option]}
              >
                {ANALYTICS_WINDOW_SHORT[option]}
              </button>
            ))}
          </div>
          <span className={styles.windowHint} aria-live="polite">
            {error ? error : `Showing ${ANALYTICS_WINDOW_LABELS[window]}`}
          </span>
        </div>
      </header>

      {shown.isEmpty ? (
        <EmptyOverview />
      ) : (
        <div className={styles.body} data-pending={loading ? "true" : undefined}>
          <div className={styles.kpiGrid}>
            {shown.performance.kpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} animate={animate} style={nextPanelStyle()} />
            ))}
          </div>

          <div className={styles.rowFunnelTimeline}>
            <FunnelPanel data={shown} style={nextPanelStyle()} />
            <TimelinePanel data={shown} reducedMotion={reducedMotion} style={nextPanelStyle()} />
          </div>

          <div className={styles.rowSenderFailure}>
            <SenderPanel data={shown} style={nextPanelStyle()} />
            <FailurePanel data={shown} style={nextPanelStyle()} />
          </div>

          <div className={styles.rowHealthHeatmap}>
            <HealthPanel data={shown} reducedMotion={reducedMotion} style={nextPanelStyle()} />
            <HeatmapPanel data={shown} style={nextPanelStyle()} />
          </div>

          <div className={styles.rowBottom}>
            <TemplatePanel data={shown} style={nextPanelStyle()} />
            <ImportPanel data={shown} style={nextPanelStyle()} />
            <ActionPanel data={shown} style={nextPanelStyle()} />
          </div>
        </div>
      )}
    </section>
  );
}

function PanelHeading({ icon: Icon, kicker, title, meta }: { icon: LucideIcon; kicker: string; title: string; meta?: string }) {
  return (
    <div className={styles.panelHeading}>
      <span className={styles.panelIcon}>
        <Icon aria-hidden="true" />
      </span>
      <div className={styles.panelHeadingCopy}>
        <span className={styles.panelKicker}>{kicker}</span>
        <strong className={styles.panelTitle}>{title}</strong>
      </div>
      {meta ? <span className={styles.panelMeta}>{meta}</span> : null}
    </div>
  );
}

function KpiCard({ kpi, animate, style }: { kpi: AnalyticsKpi; animate: boolean; style: CSSProperties }) {
  const Icon = KPI_ICONS[kpi.key] ?? Target;
  const TrendIcon = kpi.trend ? trendIcons[kpi.trend.direction] : null;
  return (
    <article className={`${styles.panel} ${styles.kpiCard}`} data-tone={kpi.tone} style={style}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}>
          <Icon aria-hidden="true" />
        </span>
        {kpi.trend && TrendIcon ? (
          <span className={styles.kpiTrend} data-direction={kpi.trend.direction}>
            <TrendIcon aria-hidden="true" />
            {kpi.trend.label}
          </span>
        ) : null}
      </div>
      <span className={styles.kpiLabel}>{kpi.label}</span>
      <strong className={styles.kpiValue}>
        {kpi.display === "—" ? "—" : <AnimatedNumber value={kpi.value} format={kpi.format} animate={animate} />}
      </strong>
      <span className={styles.kpiHint}>{kpi.hint}</span>
    </article>
  );
}

function FunnelPanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  const hasData = data.funnel.some((stage) => stage.value > 0);
  return (
    <article className={`${styles.panel} ${styles.funnelPanel}`} style={style}>
      <PanelHeading icon={Target} kicker="Delivery funnel" title="Audience to reply" />
      {hasData ? (
        <div className={styles.funnelList}>
          {data.funnel.map((stage) => (
            <div key={stage.key} className={styles.funnelRow}>
              <div className={styles.funnelLabel}>
                <span>{stage.label}</span>
                <strong>{formatCompactNumber(stage.value)}</strong>
              </div>
              <div className={styles.funnelTrack}>
                <span
                  className={styles.funnelFill}
                  style={
                    {
                      "--fill": `${stage.percentOfTop}%`,
                      "--fill-color": toneColor(stage.tone)
                    } as CSSProperties
                  }
                />
              </div>
              {stage.conversionFromPrev !== null ? (
                <span className={styles.funnelConversion}>{stage.conversionFromPrev}% conversion</span>
              ) : (
                <span className={styles.funnelConversionGhost}>{Math.max(0, Math.round(stage.percentOfTop))}% of audience</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <PanelEmpty icon={Target} message="Launch a sequence to populate the delivery funnel." />
      )}
    </article>
  );
}

function TimelinePanel({ data, reducedMotion, style }: { data: OverviewAnalytics; reducedMotion: boolean; style: CSSProperties }) {
  const { points, totals } = data.timeline;
  const hasActivity = totals.sent > 0 || totals.failed > 0 || totals.engaged > 0;
  return (
    <article className={`${styles.panel} ${styles.timelinePanel}`} style={style}>
      <PanelHeading icon={Activity} kicker="Send activity" title="Daily volume & engagement" meta={`${points.length}d`} />
      {hasActivity ? (
        <>
          <div className={styles.timelineLegend}>
            <span className={styles.legendSent}>
              <i /> Sent <b>{formatCompactNumber(totals.sent)}</b>
            </span>
            <span className={styles.legendEngaged}>
              <i /> Engaged <b>{formatCompactNumber(totals.engaged)}</b>
            </span>
            <span className={styles.legendFailed}>
              <i /> Failed <b>{formatCompactNumber(totals.failed)}</b>
            </span>
          </div>
          <TimelineChart points={points} peak={data.timeline.peak} reducedMotion={reducedMotion} />
        </>
      ) : (
        <PanelEmpty icon={Activity} message="No sends recorded yet. Activity will appear here as runs go out." />
      )}
    </article>
  );
}

function SenderPanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  return (
    <article className={`${styles.panel} ${styles.senderPanel}`} style={style}>
      <PanelHeading icon={Radar} kicker="Sender utilization" title="Rolling 24h capacity" meta={`${data.senders.length} sender${data.senders.length === 1 ? "" : "s"}`} />
      {data.senders.length ? (
        <ul className={styles.senderList}>
          {data.senders.map((sender) => (
            <li key={sender.senderProfileId} className={styles.senderRow}>
              <span className={styles.senderAvatar} aria-hidden="true">
                {(sender.name || sender.email || "?").charAt(0).toUpperCase()}
              </span>
              <div className={styles.senderInfo}>
                <strong className={styles.senderName}>{sender.name || sender.email}</strong>
                <span className={styles.senderEmail}>{sender.email}</span>
                <div className={styles.senderBar}>
                  <span
                    className={styles.senderBarFill}
                    data-pacing={sender.pacing}
                    style={{ "--fill": `${sender.utilizationPercent}%` } as CSSProperties}
                  />
                </div>
              </div>
              <div className={styles.senderStats}>
                <span className={styles.senderPacing} data-pacing={sender.pacing}>
                  {sender.pacingLabel}
                </span>
                <span className={styles.senderCount}>
                  {sender.ledgerAvailable ? (
                    <>
                      <b>{formatCompactNumber(sender.sent24h)}</b>/{formatCompactNumber(sender.limit)}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                <span className={styles.senderSub}>
                  {sender.activeSequences > 0 ? `${sender.activeSequences} active` : "Idle"}
                  {sender.resetAtLabel ? ` · resets ${sender.resetAtLabel}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty icon={Radar} message="Connect a Gmail sender to see capacity and pacing." action={{ href: "/workspace", label: "Manage senders" }} />
      )}
    </article>
  );
}

function FailurePanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  const { failures } = data;
  const retryShare = failures.total > 0 ? Math.round((failures.retryable / failures.total) * 100) : 0;
  return (
    <article className={`${styles.panel} ${styles.failurePanel}`} style={style}>
      <PanelHeading
        icon={ShieldAlert}
        kicker="Failure intelligence"
        title="What's blocking delivery"
        meta={failures.lastFailureLabel ? `last ${failures.lastFailureLabel}` : undefined}
      />
      {failures.total > 0 ? (
        <>
          <div className={styles.failureSplit}>
            <div className={styles.failureSplitBar}>
              <span className={styles.failureSplitRetry} style={{ "--share": `${retryShare}%` } as CSSProperties} />
            </div>
            <div className={styles.failureSplitLegend}>
              <span>
                <i className={styles.dotRetry} /> Retryable <b>{formatCompactNumber(failures.retryable)}</b>
              </span>
              <span>
                <i className={styles.dotPermanent} /> Permanent <b>{formatCompactNumber(failures.permanent)}</b>
              </span>
            </div>
          </div>
          <ul className={styles.failureList}>
            {failures.categories.map((category) => (
              <li key={category.key} className={styles.failureItem} data-tone={category.tone}>
                <span className={styles.failureDot} aria-hidden="true" />
                <div className={styles.failureCopy}>
                  <strong>{category.label}</strong>
                  <span>{category.description}</span>
                </div>
                <b className={styles.failureCount}>{formatCompactNumber(category.value)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <PanelEmpty icon={ShieldAlert} message="No delivery failures in this window. Everything is landing cleanly." tone="success" />
      )}
    </article>
  );
}

function HealthPanel({ data, reducedMotion, style }: { data: OverviewAnalytics; reducedMotion: boolean; style: CSSProperties }) {
  const { slices, total } = data.sequenceHealth;
  return (
    <article className={`${styles.panel} ${styles.healthPanel}`} style={style}>
      <PanelHeading icon={Layers} kicker="Sequence health" title="Status distribution" />
      {total > 0 ? (
        <div className={styles.healthBody}>
          <HealthDonut slices={slices} total={total} reducedMotion={reducedMotion} />
          <ul className={styles.healthLegend}>
            {slices.map((slice) => (
              <li key={slice.key}>
                <span className={styles.healthSwatch} style={{ "--swatch": toneColor(slice.tone) } as CSSProperties} />
                <span className={styles.healthName}>{slice.label}</span>
                <b>{formatCompactNumber(slice.value)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <PanelEmpty icon={Layers} message="Create a sequence to see status distribution." />
      )}
    </article>
  );
}

function HeatmapPanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  const { heatmap } = data;
  return (
    <article className={`${styles.panel} ${styles.heatmapPanel}`} style={style}>
      <PanelHeading
        icon={CalendarDays}
        kicker="Activity heatmap"
        title="Last 30 days"
        meta={heatmap.busiestLabel ? `peak ${heatmap.busiestLabel}` : undefined}
      />
      {heatmap.total > 0 ? (
        <>
          <ActivityHeatmap days={heatmap.days} />
          <p className={styles.heatmapSummary}>
            <strong>{formatCompactNumber(heatmap.total)}</strong> sends across the last 30 days.
          </p>
        </>
      ) : (
        <PanelEmpty icon={CalendarDays} message="No sending activity yet in the last 30 days." />
      )}
    </article>
  );
}

function TemplatePanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  return (
    <article className={`${styles.panel} ${styles.templatePanel}`} style={style}>
      <PanelHeading icon={Sparkles} kicker="Template performance" title="Top by usage" />
      {data.templates.length ? (
        <ul className={styles.templateList}>
          {data.templates.map((template) => (
            <li key={template.id} className={styles.templateRow}>
              <div className={styles.templateInfo}>
                <strong>{template.name}</strong>
                <span>
                  {template.uses} use{template.uses === 1 ? "" : "s"}
                  {template.lastUsedLabel ? ` · ${template.lastUsedLabel}` : ""}
                </span>
              </div>
              <div className={styles.templateMetrics}>
                <span title="Sent">
                  <b>{formatCompactNumber(template.sent)}</b> sent
                </span>
                <span title="Opened">
                  <b>{template.openRate === null ? "—" : `${template.openRate}%`}</b> open
                </span>
                <span title="Replied">
                  <b>{formatCompactNumber(template.replied)}</b> rep
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty icon={Sparkles} message="Use a template in a sequence to compare performance." action={{ href: "/templates", label: "Open templates" }} />
      )}
    </article>
  );
}

function ImportPanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  const { imports } = data;
  return (
    <article className={`${styles.panel} ${styles.importPanel}`} style={style}>
      <PanelHeading icon={Users} kicker="List quality" title="Imports & enrichment" />
      {imports.totalImports > 0 || imports.finderSearches > 0 ? (
        <div className={styles.importStats}>
          <div className={styles.importStat}>
            <span>Imports</span>
            <strong>{formatCompactNumber(imports.totalImports)}</strong>
            <small>{formatCompactNumber(imports.processed)} processed</small>
          </div>
          <div className={styles.importStat}>
            <span>Avg rows</span>
            <strong>{formatCompactNumber(imports.averageRows)}</strong>
            <small>{formatCompactNumber(imports.totalRows)} total</small>
          </div>
          <div className={styles.importStat}>
            <span>Mapped</span>
            <strong>{imports.mappedPercent === null ? "—" : `${imports.mappedPercent}%`}</strong>
            <small>{formatCompactNumber(imports.unmappedImports)} unmapped</small>
          </div>
          <div className={styles.importStat} data-tone={imports.failed > 0 ? "danger" : undefined}>
            <span>Issues</span>
            <strong>{formatCompactNumber(imports.failed)}</strong>
            <small>failed imports</small>
          </div>
          <div className={styles.importStat}>
            <span>Finder</span>
            <strong>{formatCompactNumber(imports.finderSearches)}</strong>
            <small>{formatCompactNumber(imports.finderResults)} results</small>
          </div>
        </div>
      ) : (
        <PanelEmpty icon={Users} message="Upload an import to see list quality." action={{ href: "/imports", label: "Import a list" }} />
      )}
    </article>
  );
}

function ActionPanel({ data, style }: { data: OverviewAnalytics; style: CSSProperties }) {
  return (
    <article className={`${styles.panel} ${styles.actionPanel}`} style={style}>
      <PanelHeading icon={Gauge} kicker="Action center" title="What needs you" />
      {data.actions.length ? (
        <ul className={styles.actionList}>
          {data.actions.map((action) => (
            <li key={action.key}>
              <Link href={action.href as Route} className={styles.actionItem} data-tone={action.tone}>
                <span className={styles.actionCount}>{formatCompactNumber(action.count)}</span>
                <span className={styles.actionCopy}>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </span>
                <span className={styles.actionCta}>
                  {action.cta}
                  <ArrowRight aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty icon={Sparkles} message="You're all caught up — nothing needs attention right now." tone="success" />
      )}
    </article>
  );
}

function PanelEmpty({
  icon: Icon,
  message,
  action,
  tone
}: {
  icon: LucideIcon;
  message: string;
  action?: { href: string; label: string };
  tone?: "success";
}) {
  return (
    <div className={styles.panelEmpty} data-tone={tone}>
      <span className={styles.panelEmptyIcon}>
        <Icon aria-hidden="true" />
      </span>
      <p>{message}</p>
      {action ? (
        <Link href={action.href as Route} className={styles.panelEmptyLink}>
          {action.label}
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function EmptyOverview() {
  return (
    <div className={styles.emptyOverview}>
      <span className={styles.emptyOverviewIcon}>
        <Activity aria-hidden="true" />
      </span>
      <div>
        <strong>Analytics will light up as you send</strong>
        <p>Launch a sequence to populate performance analytics — deliverability, engagement, sender capacity, and more.</p>
      </div>
      <Link href={"/campaigns" as Route} className="button">
        Create Sequence
      </Link>
    </div>
  );
}
