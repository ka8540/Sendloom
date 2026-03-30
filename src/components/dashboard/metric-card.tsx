import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";

import type { DashboardTrend } from "@/components/dashboard/types";
import styles from "./overview-command-center.module.css";

const trendIcons = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus
} as const;

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  trend,
  href,
  emphasis = false
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  trend: DashboardTrend;
  href?: Route;
  emphasis?: boolean;
}) {
  const TrendIcon = trendIcons[trend.direction];
  const cardClassName = `${styles.metricCard}${emphasis ? ` ${styles.metricCardPrimary}` : ""}`;

  const content = (
    <>
      <div className={styles.metricCardTop}>
        <span className={styles.metricIcon}>
          <Icon aria-hidden="true" />
        </span>
        <span className={`${styles.metricTrend} ${styles[`metricTrend${capitalize(trend.direction)}`]}`}>
          <TrendIcon aria-hidden="true" />
          {trend.label}
        </span>
      </div>
      <div className={styles.metricCardBody}>
        <span className={styles.metricLabel}>{label}</span>
        <strong className={styles.metricValue}>{value}</strong>
        <p className={styles.metricDetail}>{detail}</p>
      </div>
      <span className={styles.metricArrow}>
        <ArrowRight aria-hidden="true" />
      </span>
    </>
  );

  if (!href) {
    return <article className={cardClassName}>{content}</article>;
  }

  return (
    <Link href={href} className={cardClassName}>
      {content}
    </Link>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
