"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { formatCompactNumber } from "@/components/dashboard/formatters";
import type { HeatmapDay, SequenceHealthSlice, TimelinePoint } from "@/components/dashboard/analytics-types";
import styles from "./analytics.module.css";

const TONE_COLORS: Record<string, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "#d96952",
  neutral: "color-mix(in srgb, var(--muted) 60%, transparent)"
};

export function toneColor(tone: string) {
  return TONE_COLORS[tone] ?? "var(--accent)";
}

/** Tracks the user's reduced-motion preference so heavy animations can opt out. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Eased count-up that re-animates from the current value whenever the target changes. */
function useCountUp(target: number, enabled: boolean, duration = 900) {
  const [value, setValue] = useState(enabled ? 0 : target);
  const valueRef = useRef(value);
  valueRef.current = value;
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [target, enabled, duration]);

  return value;
}

export function AnimatedNumber({
  value,
  format = "count",
  animate = true
}: {
  value: number;
  format?: "count" | "percent";
  animate?: boolean;
}) {
  const animated = useCountUp(value, animate);
  const rounded = Math.round(animated);
  return <>{format === "percent" ? `${rounded}%` : formatCompactNumber(rounded)}</>;
}

function catmullRomPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x},${points[0].y}`;
  }
  const tension = 0.18;
  const segments = [`M ${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    segments.push(`C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x},${p2.y}`);
  }
  return segments.join(" ");
}

const WIDTH = 720;
const HEIGHT = 210;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

export function TimelineChart({
  points,
  peak,
  reducedMotion
}: {
  points: TimelinePoint[];
  peak: number;
  reducedMotion: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const safePeak = Math.max(peak, 1);
  const count = points.length;

  const geometry = useMemo(() => {
    const usableHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xFor = (index: number) => (count <= 1 ? WIDTH / 2 : (index / (count - 1)) * WIDTH);
    const yFor = (value: number) => PAD_TOP + (1 - value / safePeak) * usableHeight;
    const sentPoints = points.map((point, index) => ({ x: xFor(index), y: yFor(point.sent) }));
    const engagedPoints = points.map((point, index) => ({ x: xFor(index), y: yFor(point.engaged) }));
    const failedPoints = points.map((point, index) => ({ x: xFor(index), y: yFor(point.failed) }));
    const sentLine = catmullRomPath(sentPoints);
    const baseline = HEIGHT - PAD_BOTTOM;
    const area = sentPoints.length
      ? `${sentLine} L ${sentPoints[sentPoints.length - 1].x},${baseline} L ${sentPoints[0].x},${baseline} Z`
      : "";
    return {
      sentLine,
      area,
      engagedLine: catmullRomPath(engagedPoints),
      failedLine: catmullRomPath(failedPoints),
      sentPoints,
      baseline,
      xFor
    };
  }, [points, count, safePeak]);

  if (!count) {
    return null;
  }

  const activePoint = active !== null ? points[active] : null;

  return (
    <div className={styles.timelineChart}>
      <svg
        className={styles.timelineSvg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Send activity over the last ${count} days`}
      >
        <defs>
          <linearGradient id={`area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            x2={WIDTH}
            y1={PAD_TOP + ratio * (HEIGHT - PAD_TOP - PAD_BOTTOM)}
            y2={PAD_TOP + ratio * (HEIGHT - PAD_TOP - PAD_BOTTOM)}
            className={styles.timelineGrid}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {geometry.area ? <path d={geometry.area} fill={`url(#area-${gradientId})`} className={styles.timelineArea} /> : null}
        {geometry.failedLine ? (
          <path
            d={geometry.failedLine}
            className={`${styles.timelineLine} ${styles.timelineLineFailed}`}
            pathLength={1}
            data-animate={reducedMotion ? undefined : "true"}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {geometry.engagedLine ? (
          <path
            d={geometry.engagedLine}
            className={`${styles.timelineLine} ${styles.timelineLineEngaged}`}
            pathLength={1}
            data-animate={reducedMotion ? undefined : "true"}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {geometry.sentLine ? (
          <path
            d={geometry.sentLine}
            className={`${styles.timelineLine} ${styles.timelineLineSent}`}
            pathLength={1}
            data-animate={reducedMotion ? undefined : "true"}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {active !== null ? (
          <>
            <line
              x1={geometry.xFor(active)}
              x2={geometry.xFor(active)}
              y1={PAD_TOP}
              y2={geometry.baseline}
              className={styles.timelineGuide}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={geometry.sentPoints[active].x} cy={geometry.sentPoints[active].y} r={4} className={styles.timelineDot} />
          </>
        ) : null}
      </svg>

      <div className={styles.timelineHover}>
        {points.map((point, index) => (
          <button
            type="button"
            key={point.date}
            className={styles.timelineHoverCell}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onMouseLeave={() => setActive((current) => (current === index ? null : current))}
            onBlur={() => setActive((current) => (current === index ? null : current))}
            aria-label={`${point.label}: ${point.sent} sent, ${point.engaged} engaged, ${point.failed} failed`}
          />
        ))}
      </div>

      {activePoint ? (
        <div
          className={styles.timelineTooltip}
          style={{ "--tooltip-x": `${(active! / Math.max(count - 1, 1)) * 100}%` } as CSSProperties}
          role="status"
        >
          <strong>{activePoint.label}</strong>
          <span>
            <i className={styles.timelineTooltipDotSent} /> Sent <b>{formatCompactNumber(activePoint.sent)}</b>
          </span>
          <span>
            <i className={styles.timelineTooltipDotEngaged} /> Engaged <b>{formatCompactNumber(activePoint.engaged)}</b>
          </span>
          <span>
            <i className={styles.timelineTooltipDotFailed} /> Failed <b>{formatCompactNumber(activePoint.failed)}</b>
          </span>
        </div>
      ) : null}

      <div className={styles.timelineAxis} aria-hidden="true">
        <span>{points[0]?.label}</span>
        {count > 2 ? <span>{points[Math.floor(count / 2)]?.label}</span> : null}
        <span>{points[count - 1]?.label}</span>
      </div>
    </div>
  );
}

export function HealthDonut({
  slices,
  total,
  reducedMotion
}: {
  slices: SequenceHealthSlice[];
  total: number;
  reducedMotion: boolean;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = Math.max(total, 1);
  let offset = 0;
  const segments = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const fraction = slice.value / safeTotal;
      const length = fraction * circumference;
      const segment = {
        key: slice.key,
        color: toneColor(slice.tone),
        dasharray: `${length} ${circumference - length}`,
        dashoffset: -offset
      };
      offset += length;
      return segment;
    });

  return (
    <div className={styles.donut}>
      <svg viewBox="0 0 140 140" className={reducedMotion ? undefined : styles.donutSvg} role="img" aria-label={`${total} sequences by status`}>
        <circle cx="70" cy="70" r={radius} className={styles.donutTrack} />
        {total > 0 ? (
          segments.map((segment) => (
            <circle
              key={segment.key}
              cx="70"
              cy="70"
              r={radius}
              className={styles.donutSegment}
              stroke={segment.color}
              strokeDasharray={segment.dasharray}
              strokeDashoffset={segment.dashoffset}
            />
          ))
        ) : null}
      </svg>
      <div className={styles.donutCenter}>
        <strong>{formatCompactNumber(total)}</strong>
        <small>sequences</small>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  // Leading blanks so the first column aligns the first day to its weekday row.
  const leadingBlanks = days.length ? days[0].weekday : 0;

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapWeekdays} aria-hidden="true">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${label}-${index}`}>{index % 2 === 1 ? label : ""}</span>
        ))}
      </div>
      <div className={styles.heatmapGrid} role="img" aria-label="Daily send activity for the last 30 days">
        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <span key={`blank-${index}`} className={styles.heatmapBlank} aria-hidden="true" />
        ))}
        {days.map((day) => (
          <span
            key={day.date}
            className={styles.heatmapCell}
            data-level={day.level}
            title={`${day.label}: ${day.count} sent`}
          />
        ))}
      </div>
      <div className={styles.heatmapLegend} aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={styles.heatmapCell} data-level={level} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
