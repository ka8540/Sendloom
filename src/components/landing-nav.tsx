"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "@/app/landing.module.css";
import { SendloomLogo } from "@/components/sendloom-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

const navItems = [
  { href: "#top", label: "Home" },
  { href: "#proof", label: "Why Sendloom" },
  { href: "#workflow", label: "Workflow" },
  { href: "mailto:hello@sendloom.net", label: "Contact" }
] as const;

export function LandingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (open) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const closeMenu = () => setOpen(false);

  return (
    <header className={`${styles.nav}${open ? ` ${styles.navOpen}` : ""}`}>
      <div className={styles.navInner}>
        <div className={styles.brand}>
          <SendloomLogo className={styles.brandMark} />
          <div className={styles.brandText}>
            <strong>Sendloom</strong>
            <span>Sequence operations with real sending discipline.</span>
          </div>
        </div>

        <nav className={styles.desktopNav} aria-label="Primary">
          {navItems.map((item) => (
            <a key={item.label} className={styles.navLink} href={item.href}>
              {item.label}
            </a>
          ))}
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
            {navItems.map((item) => (
              <a key={item.label} className={styles.mobileNavLink} href={item.href} onClick={closeMenu}>
                {item.label}
              </a>
            ))}
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
