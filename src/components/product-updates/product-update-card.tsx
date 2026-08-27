import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  CircleUserRound,
  Mail,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { ProductUpdateIcon } from "@prisma/client";

import styles from "./product-update-card.module.css";

export const PRODUCT_UPDATE_ICON_COMPONENTS: Record<ProductUpdateIcon, LucideIcon> = {
  SPARKLES: Sparkles,
  BELL: Bell,
  USER: CircleUserRound,
  SEARCH: Search,
  SEND: SendHorizontal,
  MAIL: Mail,
  SHIELD: ShieldCheck,
  SETTINGS: Settings
};

export type ProductUpdateCardData = {
  title: string;
  summary: string;
  description: string;
  icon: ProductUpdateIcon;
  ctaLabel: string | null;
  ctaHref: string | null;
  publishedAt: string | null;
};

export function formatProductUpdateDate(iso: string | null) {
  if (!iso) {
    return "Not published yet";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

/**
 * The exact card users see on /whats-new. The admin composer renders the same
 * component as its live preview, so preview always matches production output.
 * All content is plain text rendered escaped by React.
 */
export function ProductUpdateCard({
  update,
  isNew = false
}: {
  update: ProductUpdateCardData;
  isNew?: boolean;
}) {
  const Icon = PRODUCT_UPDATE_ICON_COMPONENTS[update.icon] ?? Sparkles;

  return (
    <article className={`${styles.card} card`}>
      <div className={styles.topRow}>
        <span className={styles.iconWrap}>
          <Icon aria-hidden="true" />
        </span>
        {isNew ? <span className={styles.newBadge}>NEW</span> : null}
        <time className={styles.date} dateTime={update.publishedAt ?? undefined}>
          {formatProductUpdateDate(update.publishedAt)}
        </time>
      </div>
      <h2 className={styles.title}>{update.title}</h2>
      <p className={styles.summary}>{update.summary}</p>
      <p className={styles.description}>{update.description}</p>
      {update.ctaLabel && update.ctaHref ? (
        <div className={styles.ctaRow}>
          <Link href={update.ctaHref as Route} className={styles.cta}>
            {update.ctaLabel}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </article>
  );
}
