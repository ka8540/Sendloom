"use client";

import { useId, useState, type KeyboardEvent } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, PieChart, X } from "lucide-react";

import { formatCompactNumber } from "@/components/dashboard/formatters";
import styles from "./analytics-pulse.module.css";

export type PulseHealthKey = "running" | "done" | "review" | "ready";
export type PulseMetricKey = "delivered" | "issues";
export type PulseSelection = PulseMetricKey | PulseHealthKey;

export type PulseHealthSlice = {
  key: PulseHealthKey;
  label: string;
  value: number;
  percent: number;
};

export type AnalyticsPulseProps = {
  /** Total recipients targeted across the recent runs shown on the dashboard. */
  targeted: number;
  delivered: number;
  issues: number;
  /** Delivered / (delivered + issues), null when there is no outcome data yet. */
  successPercent: number | null;
  /** Delivered / eligible recipients — drives the Delivered mini meter. */
  coveragePercent: number;
  /** Issues / (delivered + issues) — drives the Issues mini meter. */
  issuePercent: number;
  sequenceTotal: number;
  health: PulseHealthSlice[];
};

type DetailAction = { label: string; href: Route };

type DetailContent = {
  title: string;
  description: string;
  stats: Array<{ label: string; value: string }>;
  actions: DetailAction[];
};

const HEALTH_KEYS: PulseHealthKey[] = ["running", "done", "review", "ready"];

function isHealthSelection(selection: PulseSelection): selection is PulseHealthKey {
  return (HEALTH_KEYS as string[]).includes(selection);
}

function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

function buildDetail(selection: PulseSelection, props: AnalyticsPulseProps): DetailContent {
  const { delivered, issues, successPercent, issuePercent, health } = props;

  switch (selection) {
    case "delivered":
      return {
        title: `${formatCompactNumber(delivered)} delivered`,
        description:
          delivered > 0
            ? "Emails that reached inboxes across your recent runs."
            : "Nothing delivered yet — metrics land here as soon as a run sends.",
        stats: [
          { label: "Delivered", value: formatCompactNumber(delivered) },
          { label: "Success rate", value: successPercent === null ? "—" : `${successPercent}%` },
          { label: "Issues", value: formatCompactNumber(issues) }
        ],
        actions: [{ label: "View sequences", href: "/campaigns" as Route }]
      };
    case "issues":
      return {
        title: issues > 0 ? `${formatCompactNumber(issues)} ${plural(issues, "issue")} to review` : "No open issues",
        description:
          issues > 0
            ? "Invalid addresses, failures, and bounces from recent runs. Suggested action: review invalid recipients."
            : "No invalid, failed, or bounced recipients across your recent runs.",
        stats: [
          { label: "Issues", value: formatCompactNumber(issues) },
          { label: "Issue rate", value: successPercent === null ? "—" : `${issuePercent}%` },
          { label: "Delivered", value: formatCompactNumber(delivered) }
        ],
        actions:
          issues > 0
            ? [
                { label: "Review sequences", href: "/campaigns" as Route },
                { label: "Open suppressions", href: "/suppressions" as Route }
              ]
            : [{ label: "View sequences", href: "/campaigns" as Route }]
      };
    default: {
      const slice = health.find((item) => item.key === selection);
      const count = slice?.value ?? 0;

      switch (selection) {
        case "running":
          return {
            title: count > 0 ? `${formatCompactNumber(count)} active ${plural(count, "run")}` : "Nothing running",
            description:
              count > 0
                ? "Sequences currently sending or queued for an execution slot."
                : "No sequences are sending right now — launch one to put outreach in motion.",
            stats: [{ label: "Running", value: formatCompactNumber(count) }],
            actions: [{ label: count > 0 ? "View running sequences" : "Launch a sequence", href: "/campaigns" as Route }]
          };
        case "done":
          return {
            title: count > 0 ? `${formatCompactNumber(count)} completed` : "None completed yet",
            description:
              count > 0
                ? "Finished runs with their final delivery numbers locked in."
                : "Completed runs will collect here once your first sequence finishes.",
            stats: [{ label: "Done", value: formatCompactNumber(count) }],
            actions: [{ label: "View completed sequences", href: "/campaigns" as Route }]
          };
        case "review":
          return {
            title:
              count > 0
                ? `${formatCompactNumber(count)} ${plural(count, "sequence")} ${count === 1 ? "needs" : "need"} review`
                : "Nothing needs review",
            description:
              count > 0
                ? "Runs with failed, invalid, or suppressed recipients worth a look."
                : "All clear — no sequences are flagged for review.",
            stats: [{ label: "Review", value: formatCompactNumber(count) }],
            actions: count > 0 ? [{ label: "View review items", href: "/campaigns" as Route }] : []
          };
        case "ready":
        default:
          return {
            title: count > 0 ? `${formatCompactNumber(count)} ready to launch` : "None staged",
            description:
              count > 0
                ? "Validated sequences waiting for you to hit go."
                : "Validate a sequence and it will show up here, ready to launch.",
            stats: [{ label: "Ready", value: formatCompactNumber(count) }],
            actions: [{ label: count > 0 ? "Launch a sequence" : "Create a sequence", href: "/campaigns" as Route }]
          };
      }
    }
  }
}

/**
 * Interactive analytics module for the Overview hero. Every metric is a real
 * button: clicking (or Enter/Space) pins a compact detail card with counts and
 * a suggested next action; hovering the donut or health bar highlights the
 * matching legend entry. Pure CSS transitions — no chart library, no polling.
 */
export function AnalyticsPulse(props: AnalyticsPulseProps) {
  const { targeted, delivered, issues, successPercent, coveragePercent, issuePercent, sequenceTotal, health } = props;
  const [selected, setSelected] = useState<PulseSelection | null>(null);
  const [hovered, setHovered] = useState<PulseSelection | null>(null);
  const baseId = useId();
  const deliveryPanelId = `${baseId}-delivery-detail`;
  const healthPanelId = `${baseId}-health-detail`;

  const hasDeliveryData = delivered > 0 || issues > 0 || targeted > 0;
  const hasSequences = sequenceTotal > 0;
  const outcomeTotal = delivered + issues;

  const toggle = (selection: PulseSelection) => {
    setSelected((current) => (current === selection ? null : selection));
  };

  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && selected !== null) {
      event.stopPropagation();
      setSelected(null);
    }
  };

  const emphasis = hovered ?? selected;
  const metricState = (key: PulseSelection) =>
    emphasis === null ? undefined : emphasis === key ? "active" : "dim";

  // Donut arcs share a pathLength of 100; a hairline gap keeps adjacent
  // segments legible without rounded caps overlapping.
  const deliveredShare = outcomeTotal > 0 ? (delivered / outcomeTotal) * 100 : 0;
  const issueShare = outcomeTotal > 0 ? 100 - deliveredShare : 0;
  const bothVisible = deliveredShare > 0 && issueShare > 0;
  const arcGap = bothVisible ? 1.1 : 0;

  const deliveredDetail = selected === "delivered" || selected === "issues" ? buildDetail(selected, props) : null;
  const healthDetail = selected !== null && isHealthSelection(selected) ? buildDetail(selected, props) : null;

  return (
    <div className={styles.pulse} onKeyDown={closeOnEscape}>
      <div className={styles.titleRow}>
        <span className={styles.titleLabel}>
          <BarChart3 aria-hidden="true" />
          Analytics pulse
        </span>
        <strong className={styles.titleValue}>{formatCompactNumber(targeted)} targeted</strong>
      </div>

      <div className={styles.deliverySection} data-overview-tour="delivery-issues">
        {hasDeliveryData ? (
          <>
            <div className={styles.deliveryLayout}>
              <div className={styles.donutWrap}>
                <svg
                  className={styles.donut}
                  viewBox="0 0 42 42"
                  role="img"
                  aria-label={`Delivery success is ${successPercent === null ? "unavailable" : `${successPercent}%`} — ${formatCompactNumber(delivered)} delivered, ${formatCompactNumber(issues)} with issues`}
                >
                  <circle className={styles.donutTrack} cx="21" cy="21" r="15.9" pathLength={100} />
                  {deliveredShare > 0 ? (
                    <circle
                      className={styles.donutSegment}
                      data-key="delivered"
                      data-state={metricState("delivered")}
                      cx="21"
                      cy="21"
                      r="15.9"
                      pathLength={100}
                      strokeDasharray={`${Math.max(deliveredShare - arcGap, 0.4)} ${100 - Math.max(deliveredShare - arcGap, 0.4)}`}
                      transform="rotate(-90 21 21)"
                      onClick={() => toggle("delivered")}
                      onMouseEnter={() => setHovered("delivered")}
                      onMouseLeave={() => setHovered(null)}
                    />
                  ) : null}
                  {issueShare > 0 ? (
                    <circle
                      className={styles.donutSegment}
                      data-key="issues"
                      data-state={metricState("issues")}
                      cx="21"
                      cy="21"
                      r="15.9"
                      pathLength={100}
                      strokeDasharray={`${Math.max(issueShare - arcGap, 0.4)} ${100 - Math.max(issueShare - arcGap, 0.4)}`}
                      strokeDashoffset={-deliveredShare}
                      transform="rotate(-90 21 21)"
                      onClick={() => toggle("issues")}
                      onMouseEnter={() => setHovered("issues")}
                      onMouseLeave={() => setHovered(null)}
                    />
                  ) : null}
                </svg>
                <span className={styles.donutCenter} aria-hidden="true">
                  <strong>{successPercent === null ? "—" : `${successPercent}%`}</strong>
                  <small>success</small>
                </span>
              </div>

              <div className={styles.metricButtons}>
                <button
                  type="button"
                  className={styles.metricButton}
                  data-key="delivered"
                  data-state={metricState("delivered")}
                  aria-expanded={selected === "delivered"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("delivered")}
                  onMouseEnter={() => setHovered("delivered")}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={styles.metricTop}>
                    <i className={styles.metricDot} aria-hidden="true" />
                    <span className={styles.metricLabel}>Delivered</span>
                    <strong className={styles.metricValue}>{formatCompactNumber(delivered)}</strong>
                  </span>
                  <span className={styles.metricTrack} aria-hidden="true">
                    <span className={styles.metricFill} style={{ width: `${coveragePercent}%` }} />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.metricButton}
                  data-key="issues"
                  data-state={metricState("issues")}
                  aria-expanded={selected === "issues"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("issues")}
                  onMouseEnter={() => setHovered("issues")}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={styles.metricTop}>
                    <i className={styles.metricDot} aria-hidden="true" />
                    <span className={styles.metricLabel}>Issues</span>
                    <strong className={styles.metricValue}>{formatCompactNumber(issues)}</strong>
                  </span>
                  <span className={styles.metricTrack} aria-hidden="true">
                    <span className={styles.metricFill} style={{ width: `${issuePercent}%` }} />
                  </span>
                </button>
              </div>
            </div>

            <div id={deliveryPanelId} className={styles.detailSlot}>
              {deliveredDetail ? (
                <DetailCard
                  detail={deliveredDetail}
                  tone={selected === "issues" ? "issues" : "delivered"}
                  onClose={() => setSelected(null)}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className={styles.deliveryEmpty}>
            <span className={styles.deliveryEmptyRing} aria-hidden="true" />
            <p>No delivery data yet. Launch a sequence and this pulse lights up with live results.</p>
          </div>
        )}
      </div>

      <div className={styles.healthSection} data-overview-tour="sequence-health">
        <div className={styles.titleRow}>
          <span className={styles.titleLabel}>
            <PieChart aria-hidden="true" />
            Sequence health
          </span>
          <strong className={styles.titleValue}>{formatCompactNumber(sequenceTotal)}</strong>
        </div>

        {hasSequences ? (
          <>
            <div
              className={styles.healthBar}
              role="img"
              aria-label={`Sequence health: ${health
                .map((slice) => `${slice.value} ${slice.label.toLowerCase()}`)
                .join(", ")}`}
            >
              {health.map((slice) =>
                slice.percent > 0 ? (
                  <span
                    key={slice.key}
                    className={styles.healthSlice}
                    data-key={slice.key}
                    data-state={metricState(slice.key)}
                    style={{ width: `${slice.percent}%` }}
                    onClick={() => toggle(slice.key)}
                    onMouseEnter={() => setHovered(slice.key)}
                    onMouseLeave={() => setHovered(null)}
                  />
                ) : null
              )}
            </div>

            <div className={styles.healthButtons}>
              {health.map((slice) => (
                <button
                  key={slice.key}
                  type="button"
                  className={styles.healthButton}
                  data-key={slice.key}
                  data-state={metricState(slice.key)}
                  aria-expanded={selected === slice.key}
                  aria-controls={healthPanelId}
                  onClick={() => toggle(slice.key)}
                  onMouseEnter={() => setHovered(slice.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={styles.healthButtonLabel}>
                    <i className={styles.metricDot} aria-hidden="true" />
                    {slice.label}
                  </span>
                  <strong className={styles.healthButtonValue}>{formatCompactNumber(slice.value)}</strong>
                </button>
              ))}
            </div>

            <div id={healthPanelId} className={styles.detailSlot}>
              {healthDetail && selected !== null && isHealthSelection(selected) ? (
                <DetailCard detail={healthDetail} tone={selected} onClose={() => setSelected(null)} />
              ) : null}
            </div>
          </>
        ) : (
          <div className={styles.healthEmpty}>
            <p>No sequences yet — health tracking starts with your first launch.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailCard({
  detail,
  tone,
  onClose
}: {
  detail: DetailContent;
  tone: PulseSelection;
  onClose: () => void;
}) {
  return (
    <div className={styles.detailCard} data-tone={tone} role="region" aria-label={detail.title}>
      <div className={styles.detailHead}>
        <strong className={styles.detailTitle}>{detail.title}</strong>
        <button type="button" className={styles.detailClose} aria-label="Close details" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <p className={styles.detailCopy}>{detail.description}</p>
      {detail.stats.length > 1 ? (
        <dl className={styles.detailStats}>
          {detail.stats.map((stat) => (
            <div key={stat.label} className={styles.detailStat}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {detail.actions.length > 0 ? (
        <div className={styles.detailActions}>
          {detail.actions.map((action) => (
            <Link key={action.label} href={action.href} className={styles.detailAction}>
              {action.label}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
