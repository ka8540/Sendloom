import type { Route } from "next";
import Link from "next/link";
import { Activity, ArrowUpRight, FileSpreadsheet, Gauge, LayoutTemplate, type LucideIcon } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import type { DailySendWindow } from "@/lib/daily-send-limit";
import { formatCompactNumber } from "@/components/dashboard/formatters";
import styles from "./overview-summary.module.css";

export type SendWindowSender = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: DailySendWindow;
};

export type ActiveSummary = {
  activeNow: number;
  total: number;
  running: number;
  queued: number;
  paused: number;
  scheduled: number;
};

export type ListsSummary = {
  processed: number;
  ready: number;
  needsMapping: number;
  recent: number;
};

export type TemplateFormatSlice = {
  key: string;
  label: string;
  count: number;
};

export type TemplatesSummary = {
  total: number;
  formats: TemplateFormatSlice[];
  updatedThisWeek: number;
};

type StatusTone = "accent" | "warning" | "danger" | "info" | "muted";

const STATUS_RAIL_TONES: Record<string, StatusTone> = {
  running: "accent",
  queued: "info",
  paused: "warning",
  scheduled: "muted"
};

export function OverviewSummary({
  active,
  lists,
  templates,
  sendWindow
}: {
  active: ActiveSummary;
  lists: ListsSummary;
  templates: TemplatesSummary;
  sendWindow: { combined: DailySendWindow; senders: SendWindowSender[] };
}) {
  return (
    <section className={styles.summary} aria-label="Workspace summary">
      <div className={styles.grid}>
        <ActiveCard data={active} />
        <ListsCard data={lists} />
        <TemplatesCard data={templates} />
        <SendWindowCardCompact combined={sendWindow.combined} senders={sendWindow.senders} />
      </div>
    </section>
  );
}

// Icon + status pill sit on their own row so the label below always gets the
// full card width — no more truncated titles when the sidebar narrows the row.
function CardHead({
  icon: Icon,
  status,
  statusTone,
  pulse
}: {
  icon: LucideIcon;
  status: string;
  statusTone: StatusTone;
  pulse?: boolean;
}) {
  return (
    <div className={styles.cardHead}>
      <span className={styles.iconBadge}>
        <Icon aria-hidden="true" />
      </span>
      <span className={styles.statusPill} data-tone={statusTone}>
        {pulse ? <span className={styles.pulseDot} aria-hidden="true" /> : null}
        {status}
      </span>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.statUnit}>{unit}</span>
    </div>
  );
}

// ---- Card 1: Active sequences -------------------------------------------------
function ActiveCard({ data }: { data: ActiveSummary }) {
  const segments = [
    { key: "running", label: "Running", value: data.running },
    { key: "queued", label: "Queued", value: data.queued },
    { key: "paused", label: "Paused", value: data.paused },
    { key: "scheduled", label: "Scheduled", value: data.scheduled }
  ].filter((segment) => segment.value > 0);
  const railTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
  const moving = data.running + data.queued;
  const status = data.running > 0 ? "Running" : data.queued > 0 ? "Queued" : "Idle";
  const statusTone: StatusTone = data.running > 0 ? "accent" : data.queued > 0 ? "info" : "muted";

  return (
    <Link href={"/campaigns" as Route} className={styles.card} data-kind="active">
      <CardHead icon={Activity} status={status} statusTone={statusTone} pulse={data.running > 0} />
      <Stat label="Active sequences" value={formatCompactNumber(moving)} unit="active now" />

      <div className={styles.visual}>
        {railTotal > 0 ? (
          <>
            <div className={styles.rail} aria-hidden="true">
              {segments.map((segment) => (
                <span
                  key={segment.key}
                  className={styles.railSegment}
                  data-tone={STATUS_RAIL_TONES[segment.key]}
                  style={{ flexGrow: segment.value }}
                />
              ))}
            </div>
            <div className={styles.chips}>
              {segments.map((segment) => (
                <span key={segment.key} className={styles.chip} data-tone={STATUS_RAIL_TONES[segment.key]}>
                  <i className={styles.chipDot} aria-hidden="true" />
                  {segment.label}
                  <b>{formatCompactNumber(segment.value)}</b>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.calm}>No runs moving right now.</p>
        )}
      </div>

      <CardFoot text={`${formatCompactNumber(data.total)} total workflows`} />
    </Link>
  );
}

// ---- Card 2: Lists ready ------------------------------------------------------
function ListsCard({ data }: { data: ListsSummary }) {
  const hasData = data.processed > 0;
  const readyPercent = hasData ? Math.round((data.ready / data.processed) * 100) : 0;
  const status = !hasData ? "Empty" : data.needsMapping > 0 ? "Needs mapping" : "Ready";
  const statusTone: StatusTone = !hasData ? "muted" : data.needsMapping > 0 ? "warning" : "accent";

  return (
    <Link href={"/imports" as Route} className={styles.card} data-kind="lists">
      <CardHead icon={FileSpreadsheet} status={status} statusTone={statusTone} />
      <Stat label="Lists ready" value={formatCompactNumber(data.processed)} unit="processed imports" />

      <div className={styles.visual}>
        {hasData ? (
          <div className={styles.ringRow}>
            <ProgressRing percent={readyPercent} tone={data.needsMapping > 0 ? "warning" : "accent"} />
            <div className={styles.miniChips}>
              <span className={styles.miniChip} data-tone="accent">
                <i className={styles.chipDot} aria-hidden="true" />
                Ready <b>{formatCompactNumber(data.ready)}</b>
              </span>
              <span className={styles.miniChip} data-tone={data.needsMapping > 0 ? "warning" : "muted"}>
                <i className={styles.chipDot} aria-hidden="true" />
                Needs mapping <b>{formatCompactNumber(data.needsMapping)}</b>
              </span>
              {data.recent > 0 ? (
                <span className={styles.miniChip} data-tone="info">
                  <i className={styles.chipDot} aria-hidden="true" />
                  New this week <b>{formatCompactNumber(data.recent)}</b>
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className={styles.calm}>No lists yet — import one to map, validate, and launch.</p>
        )}
      </div>

      <CardFoot text="Ready to map and launch" />
    </Link>
  );
}

// ---- Card 3: Templates live ---------------------------------------------------
function TemplatesCard({ data }: { data: TemplatesSummary }) {
  const hasData = data.total > 0 && data.formats.length > 0;
  const status = data.total > 0 ? "Ready" : "Empty";
  const statusTone: StatusTone = data.total > 0 ? "accent" : "muted";
  const footText =
    data.updatedThisWeek > 0
      ? `${formatCompactNumber(data.updatedThisWeek)} updated this week`
      : "Playable email assets";

  return (
    <Link href={"/templates" as Route} className={styles.card} data-kind="templates">
      <CardHead icon={LayoutTemplate} status={status} statusTone={statusTone} />
      <Stat label="Templates live" value={formatCompactNumber(data.total)} unit="email templates" />

      <div className={styles.visual}>
        {hasData ? (
          <>
            <div className={styles.rail} aria-hidden="true">
              {data.formats.map((slice, index) => (
                <span
                  key={slice.key}
                  className={styles.railSegment}
                  data-format={index % 3}
                  style={{ flexGrow: slice.count }}
                />
              ))}
            </div>
            <div className={styles.chips}>
              {data.formats.map((slice, index) => (
                <span key={slice.key} className={styles.chip} data-format={index % 3}>
                  <i className={styles.chipDot} aria-hidden="true" />
                  {slice.label}
                  <b>{formatCompactNumber(slice.count)}</b>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.calm}>No templates yet — create one to start sending.</p>
        )}
      </div>

      <CardFoot text={footText} />
    </Link>
  );
}

// ---- Card 4: Gmail send window (compact) -------------------------------------
type SendTone = "ok" | "near" | "blocked" | "paused";

function resolveSendTone(window: DailySendWindow): SendTone {
  if (!window.ledgerAvailable) return "paused";
  if (window.isBlocked) return "blocked";
  if (window.limit > 0 && window.sentLast24h >= Math.max(1, Math.floor(window.limit * 0.8))) return "near";
  return "ok";
}

const SEND_STATUS: Record<SendTone, { label: string; tone: StatusTone }> = {
  ok: { label: "Healthy", tone: "accent" },
  near: { label: "Near limit", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  paused: { label: "Paused", tone: "muted" }
};

function SendWindowCardCompact({ combined, senders }: { combined: DailySendWindow; senders: SendWindowSender[] }) {
  const tone = resolveSendTone(combined);
  const meterTone: StatusTone = SEND_STATUS[tone].tone;
  const usedPercent =
    combined.limit > 0 ? Math.min(100, Math.round((combined.sentLast24h / combined.limit) * 100)) : 0;
  const connected = senders.filter((sender) => sender.connected);
  const primary = connected[0] ?? null;
  const extraSenders = Math.max(0, connected.length - 1);
  const oldestExpiry = combined.oldestCountedSendAt
    ? new Date(new Date(combined.oldestCountedSendAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  return (
    <Link href={"/workspace" as Route} className={styles.card} data-kind="send">
      <CardHead icon={Gauge} status={SEND_STATUS[tone].label} statusTone={SEND_STATUS[tone].tone} />

      {combined.ledgerAvailable ? (
        <>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Gmail send window</span>
            <strong className={styles.statValue}>
              {combined.sentLast24h.toLocaleString()}
              <span className={styles.statValueOf}> / {combined.limit.toLocaleString()}</span>
            </strong>
            <span className={styles.statUnit}>sent · rolling 24h</span>
          </div>

          <div className={styles.visual}>
            <div
              className={styles.meter}
              data-tone={meterTone}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={combined.limit}
              aria-valuenow={combined.sentLast24h}
              aria-label={`${combined.sentLast24h.toLocaleString()} of ${combined.limit.toLocaleString()} sends used`}
            >
              <span className={styles.meterFill} style={{ width: `${usedPercent}%` }} />
            </div>
            <div className={styles.meterMeta}>
              <span className={styles.meterRemaining}>
                <strong>{combined.remaining.toLocaleString()}</strong> remaining
              </span>
              {tone === "blocked" && combined.resetAt ? (
                <span className={styles.meterReset}>
                  Resumes <LocalDateTime value={combined.resetAt} variant="time" />
                </span>
              ) : oldestExpiry ? (
                <span className={styles.meterReset}>
                  Resets from <LocalDateTime value={oldestExpiry} variant="time" />
                </span>
              ) : (
                <span className={styles.meterReset}>No sends in the last 24h</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <Stat label="Gmail send window" value="—" unit="tracking paused" />
          <div className={styles.visual}>
            <p className={styles.calm}>Send tracking is paused until the database setup completes.</p>
          </div>
        </>
      )}

      {primary ? (
        <CardFoot
          text={primary.senderName || primary.senderEmail}
          badge={extraSenders > 0 ? `+${extraSenders} sender${extraSenders === 1 ? "" : "s"}` : undefined}
        />
      ) : (
        <CardFoot text="Connect a Gmail sender to send" />
      )}
    </Link>
  );
}

// ---- Shared footer ------------------------------------------------------------
function CardFoot({ text, badge }: { text: string; badge?: string }) {
  return (
    <div className={styles.cardFoot}>
      <span className={styles.cardFootText} title={text}>
        {text}
      </span>
      {badge ? <span className={styles.cardFootBadge}>{badge}</span> : null}
      <ArrowUpRight className={styles.cardFootArrow} aria-hidden="true" />
    </div>
  );
}

function ProgressRing({ percent, tone }: { percent: number; tone: StatusTone }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={styles.ring} data-tone={tone}>
      <svg viewBox="0 0 36 36" role="img" aria-label={`${clamped}% ready`}>
        <circle className={styles.ringTrack} cx="18" cy="18" r="15.5" />
        <circle
          className={styles.ringValue}
          cx="18"
          cy="18"
          r="15.5"
          pathLength={100}
          style={{ strokeDasharray: `${clamped} ${100 - clamped}` }}
        />
      </svg>
      <span className={styles.ringText}>{clamped}%</span>
    </div>
  );
}
