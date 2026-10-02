"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./admin-ui.module.css";

export type AdminChartSeries = { key: string; name: string; color: string };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const heading =
    label && /^\d{4}-\d{2}-\d{2}$/.test(label)
      ? new Date(`${label}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : label;
  return (
    <div className={styles.chartTooltip}>
      {heading && <strong>{heading}</strong>}
      {payload.map((item) => (
        <div key={item.name}>
          <span style={{ background: item.color }} />
          {item.name}
          <b>{(item.value ?? 0).toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

function Legend({ series }: { series: AdminChartSeries[] }) {
  return (
    <div className={styles.chartLegend}>
      {series.map((item) => (
        <span key={item.key}>
          <i style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export function AdminTimeChart<T extends { day: string }>({
  data,
  series,
  height = "normal",
}: {
  data: T[];
  series: AdminChartSeries[];
  height?: "normal" | "small";
}) {
  const hasValues = data.some((row) =>
    series.some(
      (item) => Number((row as Record<string, unknown>)[item.key]) > 0,
    ),
  );
  return (
    <div>
      <Legend series={series} />
      {!hasValues ? (
        <p className={styles.compactEmpty}>
          No recorded activity in this period.
        </p>
      ) : (
        <div
          className={
            height === "small" ? styles.chartFrameSmall : styles.chartFrame
          }
          role="img"
          aria-label={`${series.map((item) => item.name).join(", ")} by UTC day`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -20 }}
              accessibilityLayer
            >
              <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={(value: string) =>
                  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })
                }
                tickLine={false}
                axisLine={false}
                minTickGap={20}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={46}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--line)" }}
              />
              {series.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  strokeWidth={2.3}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function AdminPulseBars({
  data,
}: {
  data: Array<{ day: string; sends: number }>;
}) {
  if (!data.some((row) => row.sends > 0)) {
    return (
      <p className={styles.compactEmpty}>
        No confirmed sends in the last 7 days.
      </p>
    );
  }
  return (
    <div
      className={styles.pulseChartFrame}
      role="img"
      aria-label="Daily confirmed sends over the last 7 UTC days"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
          barCategoryGap="42%"
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--analysis-grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(value: string) =>
              new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            }
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            width={46}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--surface-hover)" }}
          />
          <Bar
            dataKey="sends"
            name="Confirmed sends"
            fill="var(--analysis-green)"
            radius={[5, 5, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AdminRankedBars({
  items,
  label,
}: {
  items: Array<{ name: string; value: number }>;
  label: string;
}) {
  const hasValues = items.some((item) => item.value > 0);
  return !hasValues ? (
    <p className={styles.compactEmpty}>
      No recorded {label.toLowerCase()} in this period.
    </p>
  ) : (
    <div
      className={styles.chartFrameSmall}
      role="img"
      aria-label={`${label} by feature`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 0, right: 24, bottom: 0, left: 16 }}
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--analysis-grid)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={85}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--surface-hover)" }}
          />
          <Bar
            dataKey="value"
            name={label}
            fill="var(--analysis-green)"
            radius={[0, 5, 5, 0]}
            maxBarSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
