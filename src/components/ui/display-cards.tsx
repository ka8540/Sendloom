"use client";

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import styles from "./display-cards.module.css";

export interface DisplayCardItem {
  /** Decorative leading glyph (e.g. a lucide icon). Rendered aria-hidden. */
  icon?: ReactNode;
  title: string;
  description: string;
  /** The muted status line shown at the foot of the card. */
  status: string;
  /** Accent hue for the badge, glow, and status dot. Defaults to emerald. */
  tone?: "emerald" | "blue";
}

interface DisplayCardsProps extends ComponentPropsWithoutRef<"div"> {
  cards: DisplayCardItem[];
}

function DisplayCard({ icon, title, description, status, tone = "emerald", index }: DisplayCardItem & { index: number }) {
  return (
    <article
      className={styles.card}
      data-tone={tone}
      style={{ "--i": index, "--z": index + 1 } as CSSProperties}
    >
      <div className={styles.cardHead}>
        {icon ? (
          <span className={styles.cardIcon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <h3 className={styles.cardTitle}>{title}</h3>
      </div>

      <p className={styles.cardDescription}>{description}</p>

      <p className={styles.cardStatus}>
        <span className={styles.cardStatusDot} aria-hidden="true" />
        {status}
      </p>
    </article>
  );
}

/**
 * A layered, interactive stack of product-stage cards.
 *
 * Presentational only: pass the stage content via `cards`. Extra props (such as
 * `data-reveal`) are forwarded to the root so the host page's scroll choreography
 * can drive the entrance.
 */
export default function DisplayCards({ cards, className, ...rest }: DisplayCardsProps) {
  return (
    <div className={className ? `${styles.stack} ${className}` : styles.stack} {...rest}>
      {cards.map((card, index) => (
        <DisplayCard key={card.title} index={index} {...card} />
      ))}
    </div>
  );
}
