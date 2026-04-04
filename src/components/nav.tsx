"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { FileSpreadsheet, House, PanelLeftClose, PanelLeftOpen, ScrollText, Search, SendHorizontal, ShieldAlert, ShieldUser } from "lucide-react";
import { SendloomLogo } from "@/components/sendloom-logo";
import { SessionControls } from "@/components/session-controls";

export function AppNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items: Array<{ href: Route; label: string; icon: LucideIcon }> = isAdmin
    ? [{ href: "/admin" as Route, label: "Admin", icon: ShieldUser }]
    : [
        { href: "/workspace" as Route, label: "Overview", icon: House },
        { href: "/imports" as Route, label: "Imports", icon: FileSpreadsheet },
        { href: "/templates" as Route, label: "Templates", icon: ScrollText },
        { href: "/finder" as Route, label: "Finder", icon: Search },
        { href: "/campaigns" as Route, label: "Sequences", icon: SendHorizontal },
        { href: "/suppressions" as Route, label: "Suppressions", icon: ShieldAlert }
      ];

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">
            <SendloomLogo />
          </div>
          <div className="brand-copy">
            <h1>Sendloom</h1>
            <p className="muted">{isAdmin ? "User accounts and controls in one place." : "Lists, templates, and sequences in one place."}</p>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
          title={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
      <nav className="nav">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
      <SessionControls collapsed={collapsed} />
    </aside>
  );
}
