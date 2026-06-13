"use client";

import { Mail } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef } from "react";

import styles from "@/components/marketing/marketing-footer.module.css";
import { renderBrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";

const CONTACT_EMAIL = "ka8540@g.rit.edu";

type FooterLink = {
  external?: boolean;
  href: string;
  label: string;
};

type FooterColumn = {
  heading: string;
  links: readonly FooterLink[];
};

const columns: readonly FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { href: "/#workflow", label: "Workflow" },
      { href: "/#chaos", label: "Why it works" },
      { href: "/signup", label: "Try Sendloom" },
      { href: "/login", label: "Login" }
    ]
  },
  {
    heading: "Company",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/workspace", label: "Dashboard" },
      { href: `mailto:${CONTACT_EMAIL}`, label: "Contact", external: true }
    ]
  },
  {
    heading: "Resources",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/abuse", label: "Anti-Abuse" }
    ]
  }
] as const;

/* Truthful operating facts — deliberately not certifications. */
const badges = [
  "18+ only",
  "Google OAuth",
  "User-owned sender",
  "Safe pacing",
  "Anti-abuse controls"
] as const;

const bottomLinks: readonly FooterLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/abuse", label: "Anti-Abuse" }
] as const;

function FooterLinkItem({ external, href, label }: FooterLink) {
  const content = renderBrandText(label);
  if (external) {
    return (
      <a className={styles.link} href={href}>
        {content}
      </a>
    );
  }
  return (
    <Link className={styles.link} href={href as Route}>
      {content}
    </Link>
  );
}

/**
 * Premium glass marketing footer with a giant ghosted "Sendloom" wordmark.
 *
 * All motion is progressive enhancement: the footer renders fully visible
 * from the server. JS only adds reveal/parallax/pointer effects after it has
 * confirmed `prefers-reduced-motion` is not set (and a fine pointer, for the
 * cursor light), so nothing important is ever trapped behind an animation.
 */
export function MarketingFooter() {
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");

    const cleanups: Array<() => void> = [];

    if (!reduceMotion.matches) {
      // Staggered reveal once the footer scrolls into view.
      footer.dataset.animate = "true";
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              footer.dataset.revealed = "true";
              observer.disconnect();
              break;
            }
          }
        },
        { threshold: 0.18 }
      );
      observer.observe(footer);
      cleanups.push(() => observer.disconnect());

      // Subtle scroll parallax on the giant wordmark.
      let frame = 0;
      const onScroll = () => {
        if (frame) {
          return;
        }
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const rect = footer.getBoundingClientRect();
          const viewport = window.innerHeight || 1;
          // 0 → footer just entering from below, 1 → footer leaving past top.
          const progress = 1 - (rect.top + rect.height / 2) / (viewport + rect.height / 2);
          const clamped = Math.min(Math.max(progress, 0), 1);
          const shift = (clamped - 0.5) * 70;
          footer.style.setProperty("--mf-wordmark-y", `${shift.toFixed(1)}px`);
        });
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => {
        window.removeEventListener("scroll", onScroll);
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
      });
    }

    if (finePointer.matches && !reduceMotion.matches) {
      // Cursor-following highlight inside the glass panel.
      const panel = footer.querySelector<HTMLElement>(`.${styles.panel}`);
      if (panel) {
        let pointerFrame = 0;
        const onMove = (event: PointerEvent) => {
          const rect = panel.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          if (pointerFrame) {
            return;
          }
          pointerFrame = window.requestAnimationFrame(() => {
            pointerFrame = 0;
            panel.style.setProperty("--mf-mx", `${x.toFixed(1)}%`);
            panel.style.setProperty("--mf-my", `${y.toFixed(1)}%`);
            panel.style.setProperty("--mf-spot-opacity", "1");
          });
        };
        const onLeave = () => {
          if (pointerFrame) {
            window.cancelAnimationFrame(pointerFrame);
            pointerFrame = 0;
          }
          panel.style.setProperty("--mf-spot-opacity", "0");
        };
        panel.addEventListener("pointermove", onMove, { passive: true });
        panel.addEventListener("pointerleave", onLeave);
        cleanups.push(() => {
          if (pointerFrame) {
            window.cancelAnimationFrame(pointerFrame);
          }
          panel.removeEventListener("pointermove", onMove);
          panel.removeEventListener("pointerleave", onLeave);
        });
      }
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return (
    <footer ref={footerRef} className={styles.footer}>
      <span className={`${styles.blob} ${styles.blobTeal}`} aria-hidden="true" />
      <span className={`${styles.blob} ${styles.blobBlue}`} aria-hidden="true" />

      <div className={styles.wordmarkWrap} aria-hidden="true">
        <p className={styles.wordmark}>Sendloom</p>
      </div>

      <div className={styles.panel}>
        <div className={styles.top}>
          <div className={styles.brandBlock} style={{ "--reveal-delay": "0ms" } as CSSProperties}>
            <Link className={`${styles.brand} ${styles.reveal}`} href="/" aria-label="Sendloom home">
              <SendloomLogo className={styles.brandMark} />
              <span className={styles.brandName}>{renderBrandText("Sendloom")}</span>
            </Link>
            <p className={`${styles.tagline} ${styles.reveal}`}>
              {renderBrandText(
                "Controlled business outreach from a Gmail sender you own — import, write, sequence, and track every send in one calm workspace."
              )}
            </p>
          </div>

          {columns.map((column, index) => (
            <nav
              key={column.heading}
              className={`${styles.column} ${styles.reveal}`}
              aria-label={column.heading}
              style={{ "--reveal-delay": `${90 + index * 90}ms` } as CSSProperties}
            >
              <span className={styles.heading}>{column.heading}</span>
              {column.links.map((link) => (
                <FooterLinkItem key={`${column.heading}-${link.label}`} {...link} />
              ))}
            </nav>
          ))}
        </div>

        <div className={`${styles.badges} ${styles.reveal}`} style={{ "--reveal-delay": "360ms" } as CSSProperties}>
          <p className={styles.badgesLabel}>Built for responsible outreach</p>
          <div className={styles.badgeRow}>
            {badges.map((badge) => (
              <span key={badge} className={styles.badge}>
                <span className={styles.badgeDot} aria-hidden="true" />
                {badge}
              </span>
            ))}
          </div>
        </div>

        <hr className={styles.divider} />

        <div className={`${styles.bottom} ${styles.reveal}`} style={{ "--reveal-delay": "420ms" } as CSSProperties}>
          <p className={styles.copyright}>
            © 2026 <span className={styles.brandAccent}>Sendloom</span>. All rights reserved.
          </p>
          <div className={styles.bottomRight}>
            <div className={styles.bottomLinks}>
              {bottomLinks.map((link) => (
                <FooterLinkItem key={`bottom-${link.label}`} {...link} />
              ))}
            </div>
            <a className={styles.contact} href={`mailto:${CONTACT_EMAIL}`} aria-label="Contact Sendloom by email">
              <Mail aria-hidden="true" strokeWidth={1.8} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
