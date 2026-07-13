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
  /** One short line of microcopy — the insight strip stays compact. */
  note: string;
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

// Arcs keep a small visible floor for non-zero counts so a 0.4% issue share
// still reads as a real, clickable sliver instead of vanishing.
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
      note:
        split.issues === 0
          ? "Every outcome reached an inbox."
          : split.delivered === 0
            ? "Nothing delivered yet."
            : `Moving cleanly — ${split.issueLabel} need review.`,
      stats: [deliveredStat, issueStat, targetedStat],
      actions: [{ label: "View sequences", href: "/campaigns" as Route }]
    };
  }

  return {
    eyebrow: "Issues",
    headline: split.issues === 0 ? "No open issues" : `${split.issueLabel} need attention`,
    paired: { key: "delivered", label: `${split.deliveredLabel} delivered` },
    note:
      split.issues === 0
        ? "No invalid, failed, or bounced recipients."
        : "Check invalid, bounced, or failed records.",
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
    { label: "Share", value: `${share}%` },
    { label: "All sequences", value: formatCompactNumber(sequenceTotal) }
  ];

  switch (selection) {
    case "running":
      return {
        eyebrow: "Running",
        headline: count > 0 ? `${formatCompactNumber(count)} active ${plural(count, "run")}` : "Nothing running",
        paired: null,
        note: count > 0 ? "Sending or queued for a slot." : "Nothing is sending right now.",
        stats,
        actions: [{ label: count > 0 ? "View running sequences" : "Launch a sequence", href: "/campaigns" as Route }]
      };
    case "done":
      return {
        eyebrow: "Done",
        headline: count > 0 ? `${formatCompactNumber(count)} completed` : "None completed yet",
        paired: null,
        note: count > 0 ? "Final delivery numbers locked in." : "Finished runs collect here.",
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
        note: count > 0 ? "Failed, invalid, or suppressed recipients worth a look." : "All clear.",
        stats,
        actions: count > 0 ? [{ label: "View review items", href: "/campaigns" as Route }] : []
      };
    case "ready":
    default:
      return {
        eyebrow: "Ready",
        headline: count > 0 ? `${formatCompactNumber(count)} ready to launch` : "None staged",
        paired: null,
        note: count > 0 ? "Validated and waiting on go." : "Validate a sequence to stage it.",
        stats,
        actions: [{ label: count > 0 ? "Launch a sequence" : "Create a sequence", href: "/campaigns" as Route }]
      };
  }
}

/**
 * Interactive analytics deck for the Overview command center: a delivery
 * module (minimal ring + two selectable metric rows) beside a sequence-health
 * module (segmented bar + chip selectors). The delivered/issues split is one
 * complementary pair (see delivery-split.ts) shown outside the ring — the ring
 * center holds a single figure only. Hover/focus previews a segment; click
 * (or Enter/Space on the arcs and bar) pins a compact one-line insight strip.
 * Pure CSS transitions — no chart library, no polling.
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
  // health-bar slices); the metric rows and chips are native buttons.
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

  // The ring center follows hover first, then the pinned selection, and falls
  // back to the overall success reading. It shows one figure only — the paired
  // share always lives in the metric rows beside it.
  const deliveryFocus = isMetricSelection(hovered) ? hovered : isMetricSelection(selected) ? selected : null;
  const centerMode: "overall" | PulseMetricKey = deliveryFocus ?? "overall";
  const centerValue = split ? (centerMode === "issues" ? split.issueLabel : split.deliveredLabel) : "";
  const centerWord = centerMode === "issues" ? "issues" : centerMode === "delivered" ? "delivered" : "success";

  // Donut arcs share a pathLength of 100; a hairline gap keeps adjacent
  // segments legible without rounded caps overlapping.
  const deliveredArc = split ? visibleShare(split.deliveredShare, split.delivered, 0.4) : 0;
  const issueArc = split ? visibleShare(split.issueShare, split.issues, 0.4) : 0;
  const bothVisible = deliveredArc > 0 && issueArc > 0;
  const arcGap = bothVisible ? 1.4 : 0;

  const deliveryDetail = split && isMetricSelection(selected) ? buildDeliveryDetail(selected, split, targeted) : null;
  const healthDetail =
    selected !== null && isHealthSelection(selected) ? buildHealthDetail(selected, health, sequenceTotal) : null;

  return (
    <div className={styles.pulse} onKeyDown={closeOnEscape}>
      <section className={styles.module} data-overview-tour="delivery-issues">
        <div className={styles.moduleHead}>
          <span className={styles.moduleLabel}>
            <BarChart3 aria-hidden="true" />
            Analytics pulse
          </span>
          <strong className={styles.moduleValue}>{formatCompactNumber(targeted)} targeted</strong>
        </div>

        {split ? (
          <>
            <div className={styles.deliveryBody}>
              <div className={styles.donutColumn}>
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
                  {/* Ring center: one figure, nothing else. */}
                  <span className={styles.donutCenter} aria-hidden="true">
                    <strong key={centerMode} className={styles.donutCenterValue} data-mode={centerMode}>
                      {centerValue}
                    </strong>
                  </span>
                </div>
                <span key={centerMode} className={styles.donutCaption} data-mode={centerMode} aria-hidden="true">
                  {centerWord}
                </span>
              </div>

              <div className={styles.metricRows}>
                <button
                  type="button"
                  className={styles.metricRow}
                  data-key="delivered"
                  data-state={metricState("delivered")}
                  aria-pressed={selected === "delivered"}
                  aria-expanded={selected === "delivered"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("delivered")}
                  {...preview("delivered")}
                >
                  <i className={styles.metricDot} aria-hidden="true" />
                  <span className={styles.metricLabel}>Delivered</span>
                  <strong className={styles.metricValue}>{formatCompactNumber(split.delivered)}</strong>
                  <span className={styles.metricShare}>{split.deliveredLabel}</span>
                </button>
                <button
                  type="button"
                  className={styles.metricRow}
                  data-key="issues"
                  data-state={metricState("issues")}
                  aria-pressed={selected === "issues"}
                  aria-expanded={selected === "issues"}
                  aria-controls={deliveryPanelId}
                  onClick={() => toggle("issues")}
                  {...preview("issues")}
                >
                  <i className={styles.metricDot} aria-hidden="true" />
                  <span className={styles.metricLabel}>Issues</span>
                  <strong className={styles.metricValue}>{formatCompactNumber(split.issues)}</strong>
                  <span className={styles.metricShare}>{split.issueLabel}</span>
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
          <div className={styles.moduleEmpty}>
            <span className={styles.emptyRing} aria-hidden="true" />
            <p>No delivery data yet.</p>
          </div>
        )}
      </section>

      <section className={styles.module} data-overview-tour="sequence-health">
        <div className={styles.moduleHead}>
          <span className={styles.moduleLabel}>
            <PieChart aria-hidden="true" />
            Sequence health
          </span>
          <strong className={styles.moduleValue}>{formatCompactNumber(sequenceTotal)}</strong>
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

            <div className={styles.healthChips}>
              {health.map((slice) => (
                <button
                  key={slice.key}
                  type="button"
                  className={styles.healthChip}
                  data-key={slice.key}
                  data-state={metricState(slice.key)}
                  aria-pressed={selected === slice.key}
                  aria-expanded={selected === slice.key}
                  aria-controls={healthPanelId}
                  onClick={() => toggle(slice.key)}
                  {...preview(slice.key)}
                >
                  <i className={styles.metricDot} aria-hidden="true" />
                  <span className={styles.healthChipLabel}>{slice.label}</span>
                  <strong className={styles.healthChipValue}>{formatCompactNumber(slice.value)}</strong>
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
          <div className={styles.moduleEmpty}>
            <p>No sequences yet.</p>
          </div>
        )}
      </section>
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
        <span className={styles.detailNote}>{detail.note}</span>
      </div>
      <div className={styles.detailFoot}>
        <dl className={styles.detailStats}>
          {detail.stats.map((stat) => (
            <div key={stat.label} className={styles.detailStat}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
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
    </div>
  );
}
