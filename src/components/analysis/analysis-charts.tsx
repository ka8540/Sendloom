"use client";

import { Fragment, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import { AlertTriangle, ArrowUp, CheckCircle2, Clock3, Mail, RefreshCw, Send, ShieldCheck } from "lucide-react";

import type {
  AnalysisAttentionItem,
  AnalysisBreakdownItem,
  AnalysisHeatmapCell,
  AnalysisJourneyStage,
  AnalysisOperationalPoint,
  AnalysisRankedItem,
  AnalysisSenderChange,
  AnalysisSenderItem,
  AnalysisSequencePoint,
  AnalysisTemplateItem,
  AnalysisTrendPoint
} from "@/lib/analysis-types";
import { AnalysisCard, AnalysisEmpty, analysisColors, formatAnalysisNumber } from "@/components/analysis/analysis-ui";

import styles from "./analysis.module.css";

const toneColors = [
  analysisColors.green,
  analysisColors.blue,
  analysisColors.purple,
  analysisColors.orange,
  analysisColors.red,
  analysisColors.teal
];

type TooltipEntry = {
  name?: string;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

function ChartTooltipContent({
  active,
  payload,
  label,
  valueSuffix = ""
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueSuffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.chartTooltip}>
      {label !== undefined ? <strong>{label}</strong> : null}
      <dl>
        {payload
          .filter((entry) => entry.value !== undefined)
          .map((entry, index) => (
            <div key={`${entry.dataKey ?? entry.name ?? "value"}-${index}`}>
              <dt>
                <span style={{ backgroundColor: entry.color }} aria-hidden="true" />
                {entry.name}
              </dt>
              <dd>
                {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
                {valueSuffix}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className={styles.legend} aria-hidden="true">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function hasPositiveValues(items: Array<Record<string, unknown>>, keys: string[]) {
  return items.some((item) => keys.some((key) => typeof item[key] === "number" && Number(item[key]) > 0));
}

export function TrendsCard({
  title,
  data,
  rate = false,
  includeClicks = false
}: {
  title: string;
  data: AnalysisTrendPoint[];
  rate?: boolean;
  includeClicks?: boolean;
}) {
  const keys = rate ? ["openRate", "replyRate", ...(includeClicks ? ["clickRate"] : [])] : ["sent", "opened", "replied"];
  const summary = data.length
    ? `${title} contains ${data.length} UTC date points from ${data[0].date} through ${data[data.length - 1].date}.`
    : `${title} has no data.`;
  return (
    <AnalysisCard
      title={title}
      info={rate ? "Daily unique engagement counts divided by that day's confirmed sends." : "Confirmed sends and unique tracked engagement events grouped by UTC date."}
      summary={summary}
      action={<span className={styles.chartFrequency}>Daily</span>}
    >
      <Legend
        items={
          rate
            ? [
                { label: "Open rate", color: analysisColors.blue },
                ...(includeClicks ? [{ label: "Click rate", color: analysisColors.orange }] : []),
                { label: "Reply rate", color: analysisColors.purple }
              ]
            : [
                { label: "Sent", color: analysisColors.green },
                { label: "Opened", color: analysisColors.blue },
                { label: "Replied", color: analysisColors.purple }
              ]
        }
      />
      {!hasPositiveValues(data as unknown as Array<Record<string, unknown>>, keys) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.chartLarge}>
          <ResponsiveContainer width="100%" height="100%">
            {rate ? (
              <LineChart data={data} margin={{ top: 14, right: 10, left: -10, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(value: number) => `${value}%`}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  content={<ChartTooltipContent valueSuffix="%" />}
                  cursor={{ stroke: "var(--analysis-grid-strong)", strokeDasharray: "3 3" }}
                  allowEscapeViewBox={{ x: false, y: true }}
                />
                <Line type="monotone" dataKey="openRate" name="Open rate" stroke={analysisColors.blue} strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                {includeClicks ? (
                  <Line type="monotone" dataKey="clickRate" name="Click rate" stroke={analysisColors.orange} strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ) : null}
                <Line type="monotone" dataKey="replyRate" name="Reply rate" stroke={analysisColors.purple} strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            ) : (
              <AreaChart data={data} margin={{ top: 14, right: 10, left: -10, bottom: 0 }} accessibilityLayer>
                <defs>
                  <linearGradient id="analysisSentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={analysisColors.green} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={analysisColors.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={42} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={formatAnalysisNumber} />
                <Tooltip
                  content={<ChartTooltipContent />}
                  cursor={{ stroke: "var(--analysis-grid-strong)", strokeDasharray: "3 3" }}
                  allowEscapeViewBox={{ x: false, y: true }}
                />
                <Area type="monotone" dataKey="sent" name="Sent" stroke={analysisColors.green} fill="url(#analysisSentFill)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="opened" name="Opened" stroke={analysisColors.blue} fill="transparent" strokeWidth={2.3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="replied" name="Replied" stroke={analysisColors.purple} fill="transparent" strokeWidth={2.3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function DonutCard({
  title,
  data,
  centerValue,
  centerLabel,
  info
}: {
  title: string;
  data: AnalysisBreakdownItem[];
  centerValue: number;
  centerLabel: string;
  info: string;
}) {
  const positive = data.filter((item) => item.value > 0);
  return (
    <AnalysisCard title={title} info={info} summary={`${title}: ${positive.map((item) => `${item.name} ${item.value}`).join(", ") || "no data"}.`}>
      {!positive.length ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.donutLayout}>
          <div className={styles.donutChart}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer>
                <Pie data={positive} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="88%" paddingAngle={1.4} stroke="var(--analysis-card)">
                  {positive.map((entry, index) => (
                    <Cell key={entry.name} fill={toneColors[index % toneColors.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltipContent />} allowEscapeViewBox={{ x: false, y: true }} />
              </PieChart>
            </ResponsiveContainer>
            <div className={styles.donutCenter} aria-hidden="true">
              <strong>{formatAnalysisNumber(centerValue)}</strong>
              <span>{centerLabel}</span>
            </div>
          </div>
          <div className={styles.donutLegend}>
            {positive.map((item, index) => (
              <div key={item.name}>
                <i style={{ background: toneColors[index % toneColors.length] }} />
                <span>{item.name}</span>
                <strong>{item.percent.toFixed(1)}%</strong>
                <small>({item.value.toLocaleString()})</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </AnalysisCard>
  );
}

export function JourneyCard({ title, stages, info }: { title: string; stages: AnalysisJourneyStage[]; info: string }) {
  const hasData = stages.some((stage) => stage.value > 0);
  return (
    <AnalysisCard title={title} info={info} summary={`${title}: ${stages.map((stage) => `${stage.name} ${stage.value}`).join(", ")}.`}>
      {!hasData ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.journey}>
          {stages.map((stage, index) => (
            <Fragment key={stage.name}>
              <div className={`${styles.journeyStage} ${stage.unavailable ? styles.unavailable : ""}`}>
                <span>{stage.name}</span>
                <strong>{stage.unavailable ? "Unavailable" : stage.value.toLocaleString()}</strong>
                {stage.conversion !== null && !stage.unavailable ? <small>{stage.conversion.toFixed(1)}% converted</small> : null}
              </div>
              {index < stages.length - 1 ? <span className={styles.journeyArrow} aria-hidden="true">→</span> : null}
            </Fragment>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

export function BestDaysCard({ data }: { data: Array<{ name: string; sent: number; replies: number; replyRate: number; meetsMinimum: boolean }> }) {
  const max = Math.max(1, ...data.filter((item) => item.meetsMinimum).map((item) => item.replyRate));
  const best = [...data].filter((item) => item.meetsMinimum).sort((a, b) => b.replyRate - a.replyRate)[0];
  return (
    <AnalysisCard
      title="Best days to send"
      info="Reply rate by UTC weekday. A day is highlighted only after at least 20 confirmed sends."
      summary={best ? `${best.name} has the highest qualified reply rate at ${best.replyRate.toFixed(1)}%.` : "No weekday meets the 20-send minimum."}
    >
      {!data.some((item) => item.sent > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.weekdayChart}>
          {data.map((item) => (
            <button
              type="button"
              key={item.name}
              className={best?.name === item.name ? styles.bestDay : ""}
              aria-label={`${item.name}: ${item.sent} sent, ${item.replies} replies, ${item.replyRate}% reply rate${item.meetsMinimum ? "" : ", below minimum sample"}`}
              title={`${item.name}\n${item.sent} sent\n${item.replies} replies\n${item.replyRate.toFixed(1)}% reply rate${item.meetsMinimum ? "" : "\nBelow 20-send minimum"}`}
            >
              <i style={{ height: `${Math.max(8, item.meetsMinimum ? (item.replyRate / max) * 100 : 12)}%` }} />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.scale}><span>Lower</span><i /><span>Higher</span></div>
    </AnalysisCard>
  );
}

export function RankedListCard({ title, data, info }: { title: string; data: AnalysisRankedItem[]; info: string }) {
  return (
    <AnalysisCard title={title} info={info} summary={`${title}: ${data.map((item) => `${item.name} ${item.replyRate}%`).join(", ") || "no qualified results"}.`}>
      {!data.length ? (
        <AnalysisEmpty>No sequences meet the 20-confirmed-send minimum in this range.</AnalysisEmpty>
      ) : (
        <ol className={styles.rankedList}>
          {data.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <span className={styles.rank}>{index + 1}</span>
              <span className={styles.rankIcon}><Send aria-hidden="true" /></span>
              <span className={styles.rankCopy}>
                <strong>{item.name}</strong>
                <small>{item.sent.toLocaleString()} sent · {item.replies.toLocaleString()} replied</small>
              </span>
              <span className={styles.rankRate}>
                <strong>{item.replyRate.toFixed(1)}%</strong>
                <small>{item.change !== null && item.change !== undefined ? `${item.change >= 0 ? "+" : ""}${item.change.toFixed(1)} pp` : "Reply rate"}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </AnalysisCard>
  );
}

export function HeatmapCard({ data }: { data: AnalysisHeatmapCell[] }) {
  const days = [...new Set(data.map((item) => item.day))];
  const blocks = [...new Set(data.map((item) => item.block))];
  return (
    <AnalysisCard
      title="Best send windows"
      info="Unique replies per confirmed send, grouped into four-hour UTC blocks. Cells need at least 20 sends before intensity is scored."
      summary="Heatmap of reply rate by UTC weekday and four-hour send block."
    >
      {!data.some((item) => item.sent > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.heatmapWrap}>
          <div className={styles.heatmap} style={{ gridTemplateColumns: `3rem repeat(${blocks.length}, minmax(1.6rem, 1fr))` }}>
            <span />
            {blocks.map((block) => <span className={styles.heatmapAxis} key={block}>{block}</span>)}
            {days.map((day) => (
              <Fragment key={day}>
                <span className={styles.heatmapDay}>{day}</span>
                {data.filter((cell) => cell.day === day).map((cell) => (
                  <button
                    type="button"
                    key={`${cell.day}-${cell.block}`}
                    className={styles.heatmapCell}
                    style={{ "--cell-alpha": cell.meetsMinimum ? Math.max(0.12, cell.intensity) : 0.05 } as React.CSSProperties}
                    aria-label={`${cell.day}, ${cell.block}: ${cell.sent} sent, ${cell.replies} replies, ${cell.replyRate}% reply rate${cell.meetsMinimum ? "" : ", below minimum sample"}`}
                    title={`${cell.day}, ${cell.block}\n${cell.sent} sent\n${cell.replies} replies\n${cell.replyRate.toFixed(1)}% reply rate${cell.meetsMinimum ? "" : "\nBelow 20-send minimum"}`}
                  />
                ))}
              </Fragment>
            ))}
          </div>
          <div className={styles.scale}><span>Lower engagement</span><i /><span>Higher engagement</span></div>
        </div>
      )}
    </AnalysisCard>
  );
}

export function ScheduleTypeCard({ data }: { data: AnalysisBreakdownItem[] }) {
  const icons = [<Send key="send" />, <Clock3 key="clock" />, <RefreshCw key="refresh" />];
  return (
    <AnalysisCard
      title="Engagement by schedule type"
      info="Confirmed sends grouped by the sequence schedule type stored on each campaign. Missing legacy values normalize to Immediate."
      summary={data.map((item) => `${item.name} ${item.value} sent`).join(", ")}
    >
      {!data.some((item) => item.value > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.scheduleGrid}>
          {data.map((item, index) => (
            <div key={item.name}>
              <div className={styles.miniDonut} style={{ "--donut-value": `${item.percent * 3.6}deg`, "--donut-color": toneColors[index] } as React.CSSProperties}>
                <span>{Math.round(item.percent)}%</span>
              </div>
              <strong>{item.name}</strong>
              <small>{item.value.toLocaleString()} sent</small>
              <span className={styles.srOnly}>{icons[index]}</span>
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

export function HorizontalRateCard({ title, data, info }: { title: string; data: AnalysisRankedItem[]; info: string }) {
  return (
    <AnalysisCard title={title} info={info} summary={`${title}: ${data.map((item) => `${item.name} ${item.replyRate}%`).join(", ") || "no qualified sequences"}.`}>
      {!data.length ? (
        <AnalysisEmpty>No sequences meet the 20-confirmed-send minimum in this range.</AnalysisEmpty>
      ) : (
        <div className={styles.chartLarge}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 38, left: 12, bottom: 0 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" horizontal={false} />
              <XAxis type="number" domain={[0, "auto"]} tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={126} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip content={<ChartTooltipContent valueSuffix="%" />} allowEscapeViewBox={{ x: false, y: true }} />
              <Bar dataKey="replyRate" name="Reply rate" fill={analysisColors.green} radius={[0, 8, 8, 0]} maxBarSize={24}>
                {data.map((item, index) => <Cell key={item.name} fill={index < 2 ? analysisColors.green : toneColors[(index + 1) % toneColors.length]} />)}
                <LabelList dataKey="replyRate" position="right" formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} fill="var(--text)" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function SequenceScatterCard({ data }: { data: AnalysisSequencePoint[] }) {
  return (
    <AnalysisCard
      title="Sequence volume vs replies"
      info="Each bubble is a sequence. X is confirmed sends, Y is unique-recipient reply rate, and bubble size reflects replies."
      summary={data.map((item) => `${item.name}: ${item.sent} sent and ${item.replyRate}% replies`).join(", ") || "No sequence activity."}
    >
      {!data.some((item) => item.sent > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.chartLarge}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 18, bottom: 12, left: -8 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" />
              <XAxis type="number" dataKey="sent" name="Sent" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={formatAnalysisNumber} />
              <YAxis type="number" dataKey="replyRate" name="Reply rate" unit="%" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <ZAxis type="number" dataKey="replies" range={[70, 620]} name="Replies" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltipContent />} allowEscapeViewBox={{ x: false, y: true }} />
              <Scatter name="Sequences" data={data} fill={analysisColors.purple}>
                {data.map((item, index) => <Cell key={item.name} fill={toneColors[index % toneColors.length]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function TemplatePerformanceCard({ data }: { data: AnalysisTemplateItem[] }) {
  const max = Math.max(1, ...data.map((item) => item.replyRate));
  return (
    <AnalysisCard
      title="Template performance"
      info="Reply rate grouped by saved template identity across campaign snapshots. Historical campaign snapshots remain stable after template edits."
      summary={data.map((item) => `${item.name} ${item.replyRate}% across ${item.usageCount} sequences`).join(", ") || "No qualified templates."}
    >
      {!data.length ? (
        <AnalysisEmpty>No templates meet the 20-confirmed-send minimum in this range.</AnalysisEmpty>
      ) : (
        <div className={styles.templateList}>
          {data.map((item, index) => (
            <div key={item.name}>
              <span className={styles.templateIcon} style={{ color: toneColors[index % toneColors.length] }}><Mail aria-hidden="true" /></span>
              <span className={styles.templateName}><strong>{item.name}</strong><small>{item.usageCount} sequence{item.usageCount === 1 ? "" : "s"}</small></span>
              <i><b style={{ width: `${(item.replyRate / max) * 100}%`, background: toneColors[index % toneColors.length] }} /></i>
              <strong>{item.replyRate.toFixed(1)}%</strong>
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

export function FailureReasonsCard({ data }: { data: AnalysisBreakdownItem[] }) {
  return (
    <AnalysisCard
      title="Failure reasons"
      info="Recipient diagnostics grouped deterministically. Suppressions are shown as a separate outcome; pacing and daily-cap waits are excluded from failure totals."
      summary={data.map((item) => `${item.name} ${item.value}`).join(", ") || "No failure diagnostics."}
    >
      {!data.length ? (
        <AnalysisEmpty>No failure diagnostics are available for this range.</AnalysisEmpty>
      ) : (
        <div className={styles.chartLarge}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 42, left: 30, bottom: 0 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip content={<ChartTooltipContent />} allowEscapeViewBox={{ x: false, y: true }} />
              <Bar dataKey="value" name="Recipients" radius={[0, 7, 7, 0]} maxBarSize={24}>
                {data.map((item, index) => <Cell key={item.name} fill={toneColors[index % toneColors.length]} />)}
                <LabelList dataKey="value" position="right" fill="var(--text)" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function OperationalEventsCard({ data }: { data: AnalysisOperationalPoint[] }) {
  return (
    <AnalysisCard
      title="Operational events over time"
      info="Retry attempts and recorded safety-pause/resume events grouped by UTC date. Resume counts appear only when an explicit audit event exists."
      summary="Daily retry attempts, safety pauses, and recorded resumed-run events."
    >
      <Legend items={[{ label: "Retries", color: analysisColors.green }, { label: "Pauses", color: analysisColors.purple }, { label: "Resumed runs", color: analysisColors.blue }]} />
      {!hasPositiveValues(data as unknown as Array<Record<string, unknown>>, ["retries", "pauses", "resumed"]) ? (
        <AnalysisEmpty>No operational events were recorded in this range.</AnalysisEmpty>
      ) : (
        <div className={styles.chartMedium}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, left: -14, bottom: 0 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip content={<ChartTooltipContent />} allowEscapeViewBox={{ x: false, y: true }} />
              <Bar dataKey="retries" name="Retries" fill={analysisColors.green} radius={[5, 5, 0, 0]} />
              <Bar dataKey="pauses" name="Pauses" fill={analysisColors.purple} radius={[5, 5, 0, 0]} />
              <Bar dataKey="resumed" name="Resumed runs" fill={analysisColors.blue} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function PacingCard({ waiting, pauses, nextRecoveryAt }: { waiting: number; pauses: number; nextRecoveryAt: string | null }) {
  return (
    <AnalysisCard
      title="Pacing and daily limit"
      info="Current pending recipients with explicit Gmail pacing/safety metadata plus selected-period safety-pause events. These are waits, not failures."
      summary={`${waiting} recipients are currently waiting for sender capacity and ${pauses} safety pauses occurred in range.`}
    >
      <div className={styles.pacingList}>
        <div><span className={`${styles.roundIcon} ${styles.green}`}><Clock3 /></span><span><small>Current waiting recipients</small><strong>{waiting.toLocaleString()}</strong><em>Awaiting sender capacity</em></span></div>
        <div><span className={`${styles.roundIcon} ${styles.purple}`}><RefreshCw /></span><span><small>Send-window pauses</small><strong>{pauses.toLocaleString()}</strong><em>Selected UTC range</em></span></div>
        <p>{nextRecoveryAt ? `Next known recovery ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(nextRecoveryAt))}` : "No future recovery timestamp is currently stored."}</p>
      </div>
    </AnalysisCard>
  );
}

export function AttentionCard({ data }: { data: AnalysisAttentionItem[] }) {
  return (
    <AnalysisCard title="Attention areas" info="Deterministic issue cards shown only when stored data crosses a defined condition; no generated advice is used." summary={data.map((item) => item.title).join(", ") || "No attention rules triggered."}>
      {!data.length ? (
        <div className={styles.allClear}><ShieldCheck aria-hidden="true" /><strong>No attention rules triggered</strong><p>Stored diagnostics are within the defined thresholds for this range.</p></div>
      ) : (
        <div className={styles.attentionList}>
          {data.map((item) => (
            <div key={item.title} data-tone={item.tone}>
              <span><AlertTriangle aria-hidden="true" /></span>
              <p><strong>{item.title}</strong><small>{item.detail}</small><em>{item.action}</em></p>
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

export function SenderCapacityCard({ data }: { data: AnalysisSenderItem[] }) {
  return (
    <AnalysisCard
      title="Sender capacity"
      info="Current rolling 24-hour SendLedger usage against the configured Gmail safety limit for each sender."
      summary={data.map((item) => `${item.email}: ${item.capacity.used} of ${item.capacity.limit} used`).join(", ") || "No senders."}
    >
      {!data.length ? (
        <AnalysisEmpty>No sender profiles are available.</AnalysisEmpty>
      ) : (
        <div className={styles.capacityGrid}>
          {data.map((sender, index) => (
            <div key={sender.email}>
              <button
                type="button"
                className={styles.capacityRing}
                style={{ "--ring-value": `${Math.min(100, sender.capacity.percentUsed) * 3.6}deg`, "--ring-color": toneColors[index % toneColors.length] } as React.CSSProperties}
                aria-label={`${sender.email}: ${sender.capacity.used} used, ${sender.capacity.remaining} remaining, ${sender.capacity.limit} limit`}
                title={`${sender.email}\n${sender.capacity.used} used\n${sender.capacity.remaining} remaining\n${sender.capacity.limit} rolling 24-hour limit`}
              >
                <strong>{Math.round(sender.capacity.percentUsed)}%</strong><span>used</span>
              </button>
              <strong>{sender.capacity.used.toLocaleString()} / {sender.capacity.limit.toLocaleString()}</strong>
              <small>{sender.email}</small>
              {!sender.capacity.available ? <em>Capacity unavailable</em> : null}
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

export function SenderReplyRateCard({ data }: { data: AnalysisSenderItem[] }) {
  return (
    <AnalysisCard title="Reply rate by sender" info="Unique matched replied recipients divided by confirmed sends for each sender in the selected range." summary={data.map((item) => `${item.email} ${item.replyRate}%`).join(", ") || "No sender activity."}>
      {!data.some((item) => item.sent > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.chartLarge}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 22, right: 12, left: -8, bottom: 16 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
              <XAxis dataKey="email" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} interval={0} angle={-8} />
              <YAxis tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip content={<ChartTooltipContent valueSuffix="%" />} allowEscapeViewBox={{ x: false, y: true }} />
              <Bar dataKey="replyRate" name="Reply rate" fill={analysisColors.purple} radius={[7, 7, 0, 0]} maxBarSize={62}>
                <LabelList dataKey="replyRate" position="top" formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} fill="var(--text)" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function SenderVolumeCard({ data }: { data: AnalysisSenderItem[] }) {
  return (
    <AnalysisCard title="Send volume by sender" info="Confirmed sends with unique tracked opens and matched replies, grouped by sender for the selected range." summary={data.map((item) => `${item.email}: ${item.sent} sent, ${item.opened} opened, ${item.replied} replied`).join(", ") || "No sender activity."}>
      <Legend items={[{ label: "Sent", color: analysisColors.green }, { label: "Opened", color: analysisColors.blue }, { label: "Replied", color: analysisColors.purple }]} />
      {!data.some((item) => item.sent > 0) ? (
        <AnalysisEmpty />
      ) : (
        <div className={styles.chartMedium}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 16 }} accessibilityLayer>
              <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
              <XAxis dataKey="email" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 9 }} interval={0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={formatAnalysisNumber} />
              <Tooltip content={<ChartTooltipContent />} allowEscapeViewBox={{ x: false, y: true }} />
              <Bar dataKey="sent" name="Sent" stackId="volume" fill={analysisColors.green} />
              <Bar dataKey="opened" name="Opened" stackId="volume" fill={analysisColors.blue} />
              <Bar dataKey="replied" name="Replied" stackId="volume" fill={analysisColors.purple} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisCard>
  );
}

export function SenderHealthCard({ data }: { data: AnalysisBreakdownItem[] }) {
  const healthIcon: Record<string, ReactNode> = {
    "Reconnect needed": <AlertTriangle />,
    Synced: <RefreshCw />,
    "Pacing wait": <Clock3 />,
    Healthy: <CheckCircle2 />
  };
  return (
    <AnalysisCard title="Sender health" info="Current connection, sync, and pacing state derived from sender profiles and explicit system pause metadata." summary={data.map((item) => `${item.name} ${item.value}`).join(", ") || "No senders."}>
      {!data.length ? <AnalysisEmpty /> : (
        <div className={styles.healthList}>
          {data.map((item, index) => <div key={item.name}><span style={{ color: toneColors[index] }}>{healthIcon[item.name] ?? <CheckCircle2 />}</span><strong>{item.name}</strong><b>{item.value}</b></div>)}
        </div>
      )}
    </AnalysisCard>
  );
}

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const hours = Math.max(0, Math.round(delta / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SenderChangesCard({ data }: { data: AnalysisSenderChange[] }) {
  return (
    <AnalysisCard title="Recent sender changes" info="Stored reconnect, reply-sync, bounce-sync, and pacing timestamps within the selected range." summary={data.map((item) => item.title).join(", ") || "No sender changes."}>
      {!data.length ? <AnalysisEmpty>No sender state changes were recorded in this range.</AnalysisEmpty> : (
        <div className={styles.changesList}>
          {data.map((item, index) => (
            <div key={`${item.title}-${item.at}-${index}`}>
              <span data-tone={item.tone}>{item.tone === "orange" ? <AlertTriangle /> : item.tone === "purple" ? <Clock3 /> : item.tone === "blue" ? <RefreshCw /> : <CheckCircle2 />}</span>
              <p><strong>{item.title}</strong><small>{item.detail}</small></p>
              <time dateTime={item.at}>{relativeTime(item.at)}</time>
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}
