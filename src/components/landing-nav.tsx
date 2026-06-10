"use client";

import type { Route } from "next";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "@/app/landing.module.css";
import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

type LandingNavItem = {
  href: string;
  label: string;
};

const defaultNavItems = [
  { href: "#top", label: "Home" },
  { href: "#chaos", label: "Why Sendloom" },
  { href: "#workflow", label: "Workflow" },
  { href: "mailto:hello@sendloom.net", label: "Contact" }
] as const;

function isInternalRoute(href: string) {
  return href.startsWith("/");
}

/* Scroll depth at which the nav switches from the hero-integrated top mode
   to the floating glass card. */
const NAV_SCROLL_THRESHOLD = 80;

export function LandingNav({ items = defaultNavItems }: { items?: readonly LandingNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (open) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const updateScrolled = () => {
      setScrolled(window.scrollY > NAV_SCROLL_THRESHOLD);
    };

    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateScrolled);
    };
  }, []);

  const closeMenu = () => setOpen(false);

  return (
    <header className={`${styles.nav}${open ? ` ${styles.navOpen}` : ""}${scrolled ? ` ${styles.navScrolled}` : ""}`}>
      <div className={styles.navInner}>
        <div className={styles.brand}>
          <SendloomLogo className={styles.brandMark} />
          <div className={styles.brandText}>
            <strong>
              <BrandText>Sendloom</BrandText>
            </strong>
            <span>Sequence operations with real sending discipline.</span>
          </div>
        </div>

        <nav className={styles.desktopNav} aria-label="Primary">
          {items.map((item) =>
            isInternalRoute(item.href) ? (
              <Link key={item.label} className={styles.navLink} href={item.href as Route}>
                {item.label}
              </Link>
            ) : (
              <a key={item.label} className={styles.navLink} href={item.href}>
                {item.label}
              </a>
            )
          )}
        </nav>

        <div className={styles.desktopActions}>
          <ThemeSwitcher className={styles.desktopThemeMenu} />
          <Link className={styles.navGhostButton} href="/login">
            Login
          </Link>
          <Link className={styles.navPrimaryButton} href="/signup">
            Try it
          </Link>
        </div>

        <button
          className={styles.mobileMenuButton}
          type="button"
          aria-expanded={open}
          aria-controls="landing-mobile-nav"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {open ? (
        <div id="landing-mobile-nav" className={styles.mobilePanel}>
          <nav className={styles.mobileNav} aria-label="Mobile primary">
            {items.map((item) =>
              isInternalRoute(item.href) ? (
                <Link key={item.label} className={styles.mobileNavLink} href={item.href as Route} onClick={closeMenu}>
                  {item.label}
                </Link>
              ) : (
                <a key={item.label} className={styles.mobileNavLink} href={item.href} onClick={closeMenu}>
                  {item.label}
                </a>
              )
            )}
          </nav>

          <div className={styles.mobileMetaRow}>
            <div className={styles.mobileThemeBlock}>
              <span className={styles.mobileThemeLabel}>Theme</span>
              <ThemeSwitcher className={styles.mobileThemeMenu} />
            </div>

            <div className={styles.mobileCtaRow}>
              <Link className={styles.mobileGhostButton} href="/login" onClick={closeMenu}>
                Login
              </Link>
              <Link className={styles.mobilePrimaryButton} href="/signup" onClick={closeMenu}>
                Try it
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
