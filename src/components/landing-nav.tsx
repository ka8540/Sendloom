"use client";

import type { Route } from "next";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/app/landing.module.css";
import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

type LandingNavItem = {
  href: string;
  label: string;
};

/*
 * Every entry resolves to a real element. The previous set pointed "Why
 * Sendloom" at #chaos and "Workflow" at #workflow, neither of which existed on
 * the page any more, so both links were silent no-ops; "Contact" opened a mail
 * client instead of going to the contact block. See the anchor contract in
 * app/page.tsx — the four targets are listed there in document order.
 */
const defaultNavItems = [
  { href: "#home", label: "Home" },
  { href: "#why-sendloom", label: "Why Sendloom" },
  { href: "#workflow", label: "Workflow" },
  { href: "#contact", label: "Contact" }
] as const;

function isInternalRoute(href: string) {
  return href.startsWith("/");
}

function isSectionAnchor(href: string) {
  return href.startsWith("#");
}

/* Scroll depth at which the nav switches from the hero-integrated top mode
   to the floating glass card. */
const NAV_SCROLL_THRESHOLD = 80;

/*
 * Active-section tracking.
 *
 * Sections are tall enough that several can intersect the viewport at once, so
 * "is it visible" is not a useful question. Instead each section reports its
 * position on every scroll and the last one whose top has passed the nav line
 * wins, which is the section the reader is actually looking at. The bottom of
 * the document always resolves to the last entry so "Contact" can light up even
 * though the footer is shorter than a viewport.
 */
function useActiveSection(hrefKey: string) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    /* Keyed on a joined string rather than the array itself: `items.map(...)`
       produces a new array every render, and depending on it directly would
       tear down and re-subscribe the scroll listener on each one. */
    const anchors = hrefKey.split("\n").filter(isSectionAnchor);
    if (anchors.length === 0) {
      return;
    }

    let frame = 0;

    const update = () => {
      frame = 0;

      // Within a viewport of the end of the document the last section is the
      // one on screen, regardless of where its top sits.
      const scrolledToEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      if (scrolledToEnd) {
        setActive(anchors[anchors.length - 1]);
        return;
      }

      const line = window.innerHeight * 0.35;
      let current: string | null = null;

      for (const href of anchors) {
        const element = document.getElementById(href.slice(1));
        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= line) {
          current = href;
        }
      }

      setActive(current);
    };

    const onScroll = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [hrefKey]);

  return active;
}

export function LandingNav({ items = defaultNavItems }: { items?: readonly LandingNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const active = useActiveSection(items.map((item) => item.href).join("\n"));
  const pathname = usePathname();
  const visibleItems = items.filter((item) => item.href !== pathname);

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

  const closeMenu = useCallback(() => setOpen(false), []);

  /* Escape closes and returns focus to the control that opened the panel;
     a pointer press outside it closes without stealing focus. */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        toggleRef.current?.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  /* The panel is only rendered while open, so the media query alone cannot
     close it: rotating a phone to a desktop-width viewport would otherwise
     leave an open panel with no visible way back out. */
  useEffect(() => {
    if (!open) {
      return;
    }

    const wide = window.matchMedia("(min-width: 981px)");
    const onChange = () => {
      if (wide.matches) {
        setOpen(false);
      }
    };

    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const renderLink = (item: LandingNavItem, className: string, onClick?: () => void) => {
    const isActive = active === item.href;
    const props = {
      className: isActive ? `${className} ${styles.navLinkActive}` : className,
      /* aria-current tells a screen reader what the persistent underline says
         visually. "location" is the correct token for a section within the
         current page; "page" would claim this is a different document. */
      "aria-current": isActive ? ("location" as const) : undefined,
      onClick
    };

    return isInternalRoute(item.href) ? (
      <Link key={item.label} href={item.href as Route} {...props}>
        <span className={styles.navLinkLabel}>{item.label}</span>
      </Link>
    ) : (
      <a key={item.label} href={item.href} {...props}>
        <span className={styles.navLinkLabel}>{item.label}</span>
      </a>
    );
  };

  return (
    <header className={`${styles.nav}${open ? ` ${styles.navOpen}` : ""}${scrolled ? ` ${styles.navScrolled}` : ""}`}>
      <div className={styles.navInner}>
        <Link className={styles.brand} href="/" aria-label="Sendloom home">
          <SendloomLogo className={styles.brandMark} />
          <span className={styles.brandText}>
            <strong>
              <BrandText>Sendloom</BrandText>
            </strong>
            <span>Sequence operations with real sending discipline.</span>
          </span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary">
          {visibleItems.map((item) => renderLink(item, styles.navLink))}
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
          ref={toggleRef}
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
        <div id="landing-mobile-nav" ref={panelRef} className={styles.mobilePanel}>
          <nav className={styles.mobileNav} aria-label="Mobile primary">
            {visibleItems.map((item) => renderLink(item, styles.mobileNavLink, closeMenu))}
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
