"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LaptopMinimal, TabletSmartphone } from "lucide-react";

import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { SendloomLogo } from "@/components/sendloom-logo";

import styles from "./app-mobile-gate.module.css";

const COMPACT_TOUCH_MAX_WIDTH = 1100;
const MOBILE_OR_TABLET_UA = /android|iphone|ipad|ipod|mobile|tablet|kindle|silk|playbook/i;

function looksLikeMobileOrTablet(userAgent: string) {
  return MOBILE_OR_TABLET_UA.test(userAgent);
}

function shouldBlockDashboard(userAgent: string) {
  const hasCoarsePointer =
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    navigator.maxTouchPoints > 1;

  return window.innerWidth <= COMPACT_TOUCH_MAX_WIDTH && (hasCoarsePointer || looksLikeMobileOrTablet(userAgent));
}

function MobileDashboardBlock() {
  return (
    <main className={styles.page}>
      <AnimatedEmailPath />

      <div className={styles.frame}>
        <header className={styles.brandBar}>
          <SendloomLogo className={styles.brandMark} />
          <div className={styles.brandCopy}>
            <strong>Sendloom</strong>
            <span>Sequence operations with real sending discipline.</span>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.copyPanel}>
            <span className={styles.kicker}>Desktop only for now</span>
            <h1 className={styles.title}>The workspace is currently paused on compact screens.</h1>
            <p className={styles.description}>
              Sendloom&apos;s dashboard is tuned for larger layouts. To keep campaigns, imports, templates, and sender controls readable,
              phone and smaller tablet views are blocked for now.
            </p>

            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/">
                Back to home
              </Link>
              <a className={styles.secondaryAction} href="mailto:ka8540@g.rit.edu">
                Contact support
              </a>
            </div>

            <div className={styles.noteGrid}>
              <article className={styles.noteCard}>
                <span className={styles.noteLabel}>Best experience</span>
                <strong>Use a laptop or desktop browser.</strong>
                <p>That keeps the dashboard controls, tables, and workflow panels fully readable.</p>
              </article>

              <article className={styles.noteCard}>
                <span className={styles.noteLabel}>Right now</span>
                <strong>Small phone and tablet layouts are disabled.</strong>
                <p>Open Sendloom on a wider screen to keep working inside the app.</p>
              </article>
            </div>
          </div>

          <aside className={styles.devicePanel} aria-label="Device guidance">
            <div className={styles.deviceIcon}>
              <LaptopMinimal aria-hidden="true" />
            </div>

            <div className={styles.deviceCopy}>
              <span className={styles.deviceEyebrow}>Workspace guidance</span>
              <h2>Switch to a wider screen to continue.</h2>
              <p>Once the browser has enough room, the full dashboard comes back with the proper layout and controls.</p>
            </div>

            <div className={styles.deviceChecklist}>
              <div className={styles.deviceItem}>
                <TabletSmartphone aria-hidden="true" />
                <span>Phone and compact tablet layouts stay blocked.</span>
              </div>
              <div className={styles.deviceItem}>
                <ArrowUpRight aria-hidden="true" />
                <span>Use desktop or a larger tablet window for the app.</span>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

type AppMobileGateProps = {
  children: React.ReactNode;
  userAgent: string;
};

export function AppMobileGate({ children, userAgent }: AppMobileGateProps) {
  const normalizedUserAgent = userAgent.toLowerCase();
  const [blocked, setBlocked] = useState(() => looksLikeMobileOrTablet(normalizedUserAgent));

  useEffect(() => {
    const updateBlockedState = () => {
      setBlocked(shouldBlockDashboard(normalizedUserAgent));
    };

    updateBlockedState();
    window.addEventListener("resize", updateBlockedState);
    window.addEventListener("orientationchange", updateBlockedState);

    return () => {
      window.removeEventListener("resize", updateBlockedState);
      window.removeEventListener("orientationchange", updateBlockedState);
    };
  }, [normalizedUserAgent]);

  if (blocked) {
    return <MobileDashboardBlock />;
  }

  return <>{children}</>;
}
