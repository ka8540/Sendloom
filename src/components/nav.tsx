"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CircleUserRound,
  FileSpreadsheet,
  History,
  House,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldUser,
  Siren,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import { SessionControls } from "@/components/session-controls";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "sendloom.sidebarCollapsed";
const SIDEBAR_COLLAPSED_COOKIE_NAME = "sendloom_sidebar_collapsed";
const SIDEBAR_COLLAPSED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
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

export function AppNav({ initialCollapsed = false, isAdmin = false }: { initialCollapsed?: boolean; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
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

  const items: NavItem[] = isAdmin
    ? [
        { href: "/admin" as Route, label: "Overview", icon: LayoutDashboard, exact: true },
        { href: "/admin/users" as Route, label: "Users", icon: Users },
        { href: "/admin/restrictions" as Route, label: "Restrictions", icon: ShieldAlert },
        { href: "/admin/system-health" as Route, label: "System Health", icon: Activity },
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
      ];

  // Account is a settings/utility item, deliberately kept OUT of the primary
  // product navigation. Non-admins get it in the lower footer section (below
  // the theme control, above logout); admins manage accounts elsewhere.
  const accountHref = "/account" as Route;
  const accountActive = pathname === accountHref || pathname.startsWith(`${accountHref}/`);
  const utilityNav = isAdmin ? null : (
    <Link
      href={accountHref}
      className={`nav-item${accountActive ? " is-active" : ""}`}
      aria-current={accountActive ? "page" : undefined}
      title={collapsed ? "Account" : undefined}
    >
      <CircleUserRound aria-hidden="true" />
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

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <SessionControls collapsed={collapsed} utilityNav={utilityNav} />
    </aside>
  );
}
