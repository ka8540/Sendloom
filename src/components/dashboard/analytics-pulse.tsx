"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, PieChart, X } from "lucide-react";

import { computeDeliverySplit, type DeliverySplit } from "@/components/dashboard/delivery-split";
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
  sequenceTotal: number;
  health: PulseHealthSlice[];
};

type DetailAction = { label: string; href: Route };

type DetailContent = {
  /** Names the selected metric in text, so color is never the only signal. */
  eyebrow: string;
  headline: string;
  /** The complementary share — Delivered always carries the issue share and vice versa. */
  paired: { key: PulseMetricKey; label: string } | null;
  description: string;
  stats: Array<{ label: string; value: string }>;
  actions: DetailAction[];
};

const HEALTH_KEYS: PulseHealthKey[] = ["running", "done", "review", "ready"];

function isHealthSelection(selection: PulseSelection): selection is PulseHealthKey {
  return (HEALTH_KEYS as string[]).includes(selection);
}

function isMetricSelection(selection: PulseSelection | null): selection is PulseMetricKey {
  return selection === "delivered" || selection === "issues";
}

function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

// Bars and arcs keep a small visible floor for non-zero counts so a 0.4% issue
// share still reads as a real, clickable sliver instead of vanishing.
function visibleShare(share: number, count: number, floor: number) {
  return count > 0 ? Math.max(share, floor) : 0;
}

function buildDeliveryDetail(selection: PulseMetricKey, split: DeliverySplit, targeted: number): DetailContent {
  const deliveredStat = { label: "Delivered", value: formatCompactNumber(split.delivered) };
  const issueStat = { label: "Issues", value: formatCompactNumber(split.issues) };
  const targetedStat = { label: "Targeted", value: formatCompactNumber(Math.max(targeted, split.total)) };

  if (selection === "delivered") {
    return {
      eyebrow: "Delivered",
      headline: `${split.deliveredLabel} successful`,
      paired: { key: "issues", label: `${split.issueLabel} issues` },
      description:
        split.issues === 0
          ? "Every tracked outcome reached an inbox — nothing is waiting on review."
          : split.delivered === 0
            ? "Nothing has delivered yet — every tracked outcome needs review before this climbs."
            : `${split.deliveredLabel} of tracked recipients are moving cleanly. ${split.issueLabel} need review.`,
      stats: [deliveredStat, issueStat, targetedStat],
      actions: [{ label: "View sequences", href: "/campaigns" as Route }]
    };
  }

  return {
    eyebrow: "Issues",
    headline: split.issues === 0 ? "No open issues" : `${split.issueLabel} need attention`,
    paired: { key: "delivered", label: `${split.deliveredLabel} delivered` },
    description:
      split.issues === 0
        ? `All clear — ${split.deliveredLabel} of tracked outcomes delivered with no invalid, failed, or bounced recipients.`
        : `${split.issueLabel} of tracked recipients need review — check invalid, bounced, or failed records. ${split.deliveredLabel} delivered cleanly.`,
    stats: [issueStat, deliveredStat, targetedStat],
    actions:
      split.issues > 0
        ? [
            { label: "Review sequences", href: "/campaigns" as Route },
            { label: "Open suppressions", href: "/suppressions" as Route }
          ]
        : [{ label: "View sequences", href: "/campaigns" as Route }]
  };
}

function buildHealthDetail(
  selection: PulseHealthKey,
  health: PulseHealthSlice[],
  sequenceTotal: number
): DetailContent {
  const slice = health.find((item) => item.key === selection);
  const count = slice?.value ?? 0;
  const share = sequenceTotal > 0 ? Math.round((count / sequenceTotal) * 100) : 0;
  const stats = [
    { label: slice?.label ?? "Count", value: formatCompactNumber(count) },
    { label: "Share", value: `${share}%` },
    { label: "All sequences", value: formatCompactNumber(sequenceTotal) }
  ];

  switch (selection) {
    case "running":
      return {
        eyebrow: "Running",
        headline: count > 0 ? `${formatCompactNumber(count)} active ${plural(count, "run")}` : "Nothing running",
        paired: null,
        description:
          count > 0
            ? "Sequences currently sending or queued for an execution slot."
            : "No sequences are sending right now — launch one to put outreach in motion.",
        stats,
        actions: [{ label: count > 0 ? "View running sequences" : "Launch a sequence", href: "/campaigns" as Route }]
      };
    case "done":
      return {
        eyebrow: "Done",
        headline: count > 0 ? `${formatCompactNumber(count)} completed` : "None completed yet",
        paired: null,
        description:
          count > 0
            ? "Finished runs with their final delivery numbers locked in."
            : "Completed runs will collect here once your first sequence finishes.",
        stats,
        actions: [{ label: "View completed sequences", href: "/campaigns" as Route }]
      };
    case "review":
      return {
        eyebrow: "Review",
        headline:
          count > 0
            ? `${formatCompactNumber(count)} ${plural(count, "sequence")} ${count === 1 ? "needs" : "need"} review`
            : "Nothing needs review",
        paired: null,
        description:
          count > 0
            ? "Runs with failed, invalid, or suppressed recipients worth a look."
            : "All clear — no sequences are flagged for review.",
        stats,
        actions: count > 0 ? [{ label: "View review items", href: "/campaigns" as Route }] : []
      };
    case "ready":
    default:
      return {
        eyebrow: "Ready",
        headline: count > 0 ? `${formatCompactNumber(count)} ready to launch` : "None staged",
        paired: null,
        description:
          count > 0
            ? "Validated sequences waiting for you to hit go."
            : "Validate a sequence and it will show up here, ready to launch.",
        stats,
        actions: [{ label: count > 0 ? "Launch a sequence" : "Create a sequence", href: "/campaigns" as Route }]
      };
  }
}

/**
 * Interactive analytics module for the Overview hero. The delivered/issues
 * split is computed once (complementary pair — see delivery-split.ts) and shown
 * as a pair everywhere: donut center, metric-card badges, and the pinned
 * insight panel. Hover/focus previews a segment; click (or Enter/Space, on the
 * donut arcs and health bar too) pins the detail. Pure CSS transitions — no
 * chart library, no polling.
 */
export function AnalyticsPulse(props: AnalyticsPulseProps) {
  const { targeted, delivered, issues, sequenceTotal, health } = props;
  const [selected, setSelected] = useState<PulseSelection | null>(null);
  const [hovered, setHovered] = useState<PulseSelection | null>(null);
  const baseId = useId();
  const deliveryPanelId = `${baseId}-delivery-detail`;
  const healthPanelId = `${baseId}-health-detail`;

  const split = useMemo(() => computeDeliverySplit(delivered, issues), [delivered, issues]);
  const hasSequences = sequenceTotal > 0;

  const toggle = (selection: PulseSelection) => {
    setSelected((current) => (current === selection ? null : selection));
  };

  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && selected !== null) {
      event.stopPropagation();
      setSelected(null);
    }
  };

  // Enter/Space activation for the non-button interactive shapes (SVG arcs and
  // health-bar slices); the metric cards are native buttons and need no help.
  const segmentKeyDown = (selection: PulseSelection) => (event: KeyboardEvent<Element>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(selection);
    }
  };

  const preview = (selection: PulseSelection) => ({
    onMouseEnter: () => setHovered(selection),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(selection),
    onBlur: () => setHovered(null)
  });

  const emphasis = hovered ?? selected;
  const metricState = (key: PulseSelection) =>
    emphasis === null ? undefined : emphasis === key ? "active" : "dim";

  // The donut center follows hover first, then the pinned selection, and falls
  // back to the overall success reading. Every mode shows both shares.
  const deliveryFocus = isMetricSelection(hovered) ? hovered : isMetricSelection(selected) ? selected : null;
  const centerMode: "overall" | PulseMetricKey = deliveryFocus ?? "overall";

  // Donut arcs share a pathLength of 100; a hairline gap keeps adjacent
  // segments legible without rounded caps overlapping.
  const deliveredArc = split ? visibleShare(split.deliveredShare, split.delivered, 0.4) : 0;
  const issueArc = split ? visibleShare(split.issueShare, split.issues, 0.4) : 0;
  const bothVisible = deliveredArc > 0 && issueArc > 0;
  const arcGap = bothVisible ? 1.1 : 0;

  const deliveryDetail = split && isMetricSelection(selected) ? buildDeliveryDetail(selected, split, targeted) : null;
  const healthDetail =
    selected !== null && isHealthSelection(selected) ? buildHealthDetail(selected, health, sequenceTotal) : null;

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
        {split ? (
          <>
            <div className={styles.deliveryLayout}>
              <div className={styles.donutWrap}>
                <svg
                  className={styles.donut}
                  viewBox="0 0 42 42"
                  role="group"
                  aria-label={`Delivery outcomes: ${split.deliveredLabel} delivered (${formatCompactNumber(split.delivered)}), ${split.issueLabel} issues (${formatCompactNumber(split.issues)})`}
                >
                  <circle className={styles.donutTrack} cx="21" cy="21" r="15.9" pathLength={100} />
                  {deliveredArc > 0 ? (
                    <circle
                      className={styles.donutSegment}
                      data-key="delivered"
                      data-state={metricState("delivered")}
                      role="button"
                      tabIndex={0}
                      aria-label={`Delivered segment: ${split.deliveredLabel} of outcomes`}
                      aria-pressed={selected === "delivered"}
                      cx="21"
                      cy="21"
                      r="15.9"
                      pathLength={100}
                      strokeDasharray={`${Math.max(deliveredArc - arcGap, 0.4)} ${100 - Math.max(deliveredArc - arcGap, 0.4)}`}
                      transform="rotate(-90 21 21)"
                      onClick={() => toggle("delivered")}
                      onKeyDown={segmentKeyDown("delivered")}
                      {...preview("delivered")}
                    />
                  ) : null}
                  {issueArc > 0 ? (
                    <circle
                      className={styles.donutSegment}
                      data-key="issues"
                      data-state={metricState("issues")}
                      role="button"
                      tabIndex={0}
                      aria-label={`Issues segment: ${split.issueLabel} of outcomes`}
                      aria-pressed={selected === "issues"}
                      cx="21"
                      cy="21"
                      r="15.9"
                      pathLength={100}
                      strokeDasharray={`${Math.max(issueArc - arcGap, 0.4)} ${100 - Math.max(issueArc - arcGap, 0.4)}`}
                      strokeDashoffset={-deliveredArc}
                      transform="rotate(-90 21 21)"
                      onClick={() => toggle("issues")}
                      onKeyDown={segmentKeyDown("issues")}
                      {...preview("issues")}
                    />
                  ) : null}
                </svg>
                <span className={styles.donutCenter} aria-hidden="true">
                  <span key={centerMode} className={styles.donutCenterSwap} data-mode={centerMode}>
                    <strong>{centerMode === "issues" ? split.issueLabel : split.deliveredLabel}</strong>
                    <small>{centerMode === "issues" ? "issues" : centerMode === "delivered" ? "delivered" : "success"}</small>
                    <em className={styles.donutCenterPaired}>
                      {centerMode === "issues" ? `${split.deliveredLabel} delivered` : `${split.issueLabel} issues`}
                    </em>
                  </span>
                </span>
              </div>

              <div className={styles.metricButtons}>
                <button
                  type="button"
                  className={styles.metricButton}
                  data-key="delivered"
                  data-state={metricState("delivered")}
                  aria-pressed={selected === "delivered"}
                  aria-expanded={selected === "delivered"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("delivered")}
                  {...preview("delivered")}
                >
                  <span className={styles.metricTop}>
                    <i className={styles.metricDot} aria-hidden="true" />
                    <span className={styles.metricLabel}>Delivered</span>
                    <span className={styles.metricNumbers}>
                      <strong className={styles.metricValue}>{formatCompactNumber(split.delivered)}</strong>
                      <span className={styles.metricShare}>{split.deliveredLabel}</span>
                    </span>
                  </span>
                  <span className={styles.metricTrack} aria-hidden="true">
                    <span
                      className={styles.metricFill}
                      style={{ width: `${visibleShare(split.deliveredShare, split.delivered, 1.5)}%` }}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.metricButton}
                  data-key="issues"
                  data-state={metricState("issues")}
                  aria-pressed={selected === "issues"}
                  aria-expanded={selected === "issues"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("issues")}
                  {...preview("issues")}
                >
                  <span className={styles.metricTop}>
                    <i className={styles.metricDot} aria-hidden="true" />
                    <span className={styles.metricLabel}>Issues</span>
                    <span className={styles.metricNumbers}>
                      <strong className={styles.metricValue}>{formatCompactNumber(split.issues)}</strong>
                      <span className={styles.metricShare}>{split.issueLabel}</span>
                    </span>
                  </span>
                  <span className={styles.metricTrack} aria-hidden="true">
                    <span
                      className={styles.metricFill}
                      style={{ width: `${visibleShare(split.issueShare, split.issues, 1.5)}%` }}
                    />
                  </span>
                </button>
              </div>
            </div>

            <div id={deliveryPanelId} className={styles.detailSlot}>
              {deliveryDetail && isMetricSelection(selected) ? (
                <DetailCard key={selected} detail={deliveryDetail} tone={selected} onClose={() => setSelected(null)} />
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
              role="group"
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
                    role="button"
                    tabIndex={0}
                    aria-label={`${slice.label}: ${formatCompactNumber(slice.value)} ${plural(slice.value, "sequence")}`}
                    aria-pressed={selected === slice.key}
                    style={{ width: `${slice.percent}%` }}
                    onClick={() => toggle(slice.key)}
                    onKeyDown={segmentKeyDown(slice.key)}
                    {...preview(slice.key)}
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
                  aria-pressed={selected === slice.key}
                  aria-expanded={selected === slice.key}
                  aria-controls={healthPanelId}
                  onClick={() => toggle(slice.key)}
                  {...preview(slice.key)}
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
                <DetailCard key={selected} detail={healthDetail} tone={selected} onClose={() => setSelected(null)} />
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
    <div
      className={styles.detailCard}
      data-tone={tone}
      role="region"
      aria-label={`${detail.eyebrow}: ${detail.headline}`}
    >
      <div className={styles.detailHead}>
        <span className={styles.detailEyebrow}>
          <i className={styles.metricDot} aria-hidden="true" />
          {detail.eyebrow}
        </span>
        <button type="button" className={styles.detailClose} aria-label="Close details" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className={styles.detailHeadline}>
        <strong>{detail.headline}</strong>
        {detail.paired ? (
          <span className={styles.detailPaired} data-key={detail.paired.key}>
            {detail.paired.label}
          </span>
        ) : null}
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
