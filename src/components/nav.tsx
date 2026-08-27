"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  CircleUserRound,
  FileSpreadsheet,
  History,
  House,
  LayoutDashboard,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldUser,
  Siren,
  Sparkles,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import { SessionControls } from "@/components/session-controls";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "sendloom.sidebarCollapsed";
const SIDEBAR_COLLAPSED_COOKIE_NAME = "sendloom_sidebar_collapsed";
const SIDEBAR_COLLAPSED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const ANALYSIS_NAVIGATION_ID = "analysis-sidebar-navigation";
// Dispatched by the What's New view after seen rows are written (mirrors the
// constant in whats-new-view.tsx; kept as a string so nav stays import-light).
const PRODUCT_UPDATES_SEEN_EVENT = "sendloom:product-updates-seen";
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function readStoredCookieSidebarCollapsed() {
  try {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${SIDEBAR_COLLAPSED_COOKIE_NAME}=`))
      ?.split("=")[1];

    if (cookie === "true") {
      return true;
    }

    if (cookie === "false") {
      return false;
    }
  } catch {
    return null;
  }

  return null;
}

function readStoredSidebarCollapsed(fallback: boolean) {
  const cookieValue = readStoredCookieSidebarCollapsed();
  if (cookieValue !== null) {
    return cookieValue;
  }

  try {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);

    if (storedValue === "true") {
      return true;
    }

    if (storedValue === "false") {
      return false;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function storeSidebarCollapsed(collapsed: boolean) {
  try {
    document.documentElement.dataset.sidebarCollapsed = collapsed ? "true" : "false";
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE_NAME}=${collapsed ? "true" : "false"}; path=/; max-age=${SIDEBAR_COLLAPSED_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // Keep the current session state usable if cookies are unavailable.
  }

  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Keep the in-memory sidebar state usable when storage is unavailable.
  }
}

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Match only the exact pathname, not sub-paths */
  exact?: boolean;
};

/** What's New badge: 1–9 shown as-is, 10+ collapsed to "9+", hidden at 0. */
function formatUnseenBadge(count: number) {
  if (count <= 0) {
    return null;
  }
  return count >= 10 ? "9+" : String(count);
}

export function AppNav({
  initialCollapsed = false,
  isAdmin = false,
  profilePhotoUrl = null,
  whatsNewUnseenCount = 0
}: {
  initialCollapsed?: boolean;
  isAdmin?: boolean;
  profilePhotoUrl?: string | null;
  whatsNewUnseenCount?: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [unseenCount, setUnseenCount] = useState(whatsNewUnseenCount);
  const analysisRouteActive = pathname === "/analysis" || pathname.startsWith("/analysis/");
  const [analysisOpen, setAnalysisOpen] = useState(analysisRouteActive);
  const previousPathnameRef = useRef(pathname);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const nextCollapsed = !current;
      storeSidebarCollapsed(nextCollapsed);
      return nextCollapsed;
    });
  }, []);

  useIsomorphicLayoutEffect(() => {
    const storedCollapsed = readStoredSidebarCollapsed(initialCollapsed);
    setCollapsed(storedCollapsed);
    storeSidebarCollapsed(storedCollapsed);
  }, [initialCollapsed]);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) {
      return;
    }

    previousPathnameRef.current = pathname;
    setAnalysisOpen(analysisRouteActive);
  }, [analysisRouteActive, pathname]);

  // Keep the server-computed unseen count in sync, then listen for the What's
  // New view reporting freshly-written seen rows (no full reload needed).
  useEffect(() => {
    setUnseenCount(whatsNewUnseenCount);
  }, [whatsNewUnseenCount]);

  useEffect(() => {
    function onProductUpdatesSeen(event: Event) {
      const detail = (event as CustomEvent<{ unseenCount?: number }>).detail;
      setUnseenCount(Math.max(0, detail?.unseenCount ?? 0));
    }

    window.addEventListener(PRODUCT_UPDATES_SEEN_EVENT, onProductUpdatesSeen);
    return () => window.removeEventListener(PRODUCT_UPDATES_SEEN_EVENT, onProductUpdatesSeen);
  }, []);

  const items: NavItem[] = isAdmin
    ? [
        { href: "/admin" as Route, label: "Overview", icon: LayoutDashboard, exact: true },
        { href: "/admin/users" as Route, label: "Users", icon: Users },
        { href: "/admin/restrictions" as Route, label: "Restrictions", icon: ShieldAlert },
        { href: "/admin/system-health" as Route, label: "System Health", icon: Activity },
        { href: "/admin/system-notices" as Route, label: "System Notices", icon: Megaphone },
        { href: "/admin/product-updates" as Route, label: "Product Updates", icon: Sparkles },
        { href: "/admin/activity" as Route, label: "Activity Logs", icon: History },
        { href: "/admin/incidents" as Route, label: "Incident Reports", icon: Siren },
      ]
    : [
        { href: "/workspace" as Route, label: "Overview", icon: House },
        { href: "/finder" as Route, label: "Finder", icon: Search },
        { href: "/prospects" as Route, label: "Discover", icon: UserRoundSearch },
        { href: "/imports" as Route, label: "Imports", icon: FileSpreadsheet },
        { href: "/templates" as Route, label: "Templates", icon: ScrollText },
        { href: "/campaigns" as Route, label: "Sequences", icon: SendHorizontal },
        { href: "/analysis" as Route, label: "Analysis", icon: ChartNoAxesCombined },
        { href: "/whats-new" as Route, label: "What's New", icon: Sparkles },
      ];

  const analysisItems: Array<{ href: Route; label: string }> = [
    { href: "/analysis" as Route, label: "Summary" },
    { href: "/analysis/engagement" as Route, label: "Engagement" },
    { href: "/analysis/sequences" as Route, label: "Sequences" },
    { href: "/analysis/reliability" as Route, label: "Reliability" },
    { href: "/analysis/senders" as Route, label: "Senders" }
  ];

  // Account is a settings/utility item, deliberately kept OUT of the primary
  // product navigation. Non-admins get it in the lower footer section (below
  // the theme control, above logout); admins manage accounts elsewhere.
  const accountHref = "/account" as Route;
  const accountActive = pathname === accountHref || pathname.startsWith(`${accountHref}/`);
  // The avatar replaces only the Account icon; on any load failure it falls
  // back to the generic icon so a broken image is never shown.
  const showAvatar = Boolean(profilePhotoUrl) && !avatarFailed;
  const utilityNav = isAdmin ? null : (
    <Link
      href={accountHref}
      className={`nav-item${accountActive ? " is-active" : ""}`}
      aria-current={accountActive ? "page" : undefined}
      title={collapsed ? "Account" : undefined}
    >
      {showAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profilePhotoUrl ?? ""}
          alt=""
          aria-hidden="true"
          className="nav-avatar"
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <CircleUserRound aria-hidden="true" />
      )}
      <span>Account</span>
    </Link>
  );

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">
            <SendloomLogo />
          </div>
          <div className="brand-copy">
            <h1>
              <BrandText>Sendloom</BrandText>
            </h1>
            <p className="muted">{isAdmin ? "User accounts and controls in one place." : "Lists, templates, and sequences in one place."}</p>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
          title={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      {isAdmin && (
        <div className="nav-section-header">
          <ShieldUser aria-hidden="true" />
          <span>Admin</span>
        </div>
      )}

      <nav className="nav" aria-label={isAdmin ? "Admin navigation" : "Main navigation"}>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          const isAnalysis = String(item.href) === "/analysis";

          if (isAnalysis && !collapsed) {
            return (
              <Fragment key={item.href}>
                <button
                  className={`nav-item nav-analysis-toggle${active ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setAnalysisOpen((current) => !current)}
                  aria-expanded={analysisOpen}
                  aria-controls={ANALYSIS_NAVIGATION_ID}
                  aria-label={`${analysisOpen ? "Collapse" : "Expand"} Analysis navigation`}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  <ChevronDown
                    className={`nav-analysis-chevron${analysisOpen ? " is-open" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={ANALYSIS_NAVIGATION_ID}
                  className="nav-submenu"
                  aria-label="Analysis navigation"
                  hidden={!analysisOpen}
                >
                  {analysisItems.map((analysisItem) => {
                    const childActive = pathname === analysisItem.href;
                    return (
                      <Link
                        key={analysisItem.href}
                        href={analysisItem.href}
                        className={`nav-submenu-item${childActive ? " is-active" : ""}`}
                        aria-current={childActive ? "page" : undefined}
                      >
                        <span aria-hidden="true" />
                        {analysisItem.label}
                      </Link>
                    );
                  })}
                </div>
              </Fragment>
            );
          }

          const unseenBadge =
            String(item.href) === "/whats-new" ? formatUnseenBadge(unseenCount) : null;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " is-active" : ""}`}
              aria-current={active && !isAnalysis ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              {unseenBadge ? (
                <span className="nav-badge" aria-label={`${unseenCount} unseen product updates`}>
                  {unseenBadge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <SessionControls collapsed={collapsed} utilityNav={utilityNav} />
    </aside>
  );
}
